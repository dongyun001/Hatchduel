/**
 * Postgres 存储适配（Demo 部署形态：单实例 2C2G，连接池 ≤ 20）。
 *
 * 设计要点：
 * - 存档整体存 `profiles.data`（jsonb）；写操作按 `revision` 做条件更新实现 CAS，
 *   避免“读-改-写”并发覆盖（PITFALLS P-029 / P-105）；
 * - 外部身份列各自唯一，保证同一 device / openid / steamId 不会分裂成两个账号；
 * - 幂等结果按 `(scope, key)` 主键去重；`ON CONFLICT DO NOTHING` 保证并发下只留一份。
 *
 * 事务：单机单实例下，写路径由服务层的按账号互斥 + revision CAS 保证足够强度；
 * 跨实例部署时需要 `SELECT ... FOR UPDATE`，当前不引入。
 */
import { readdir, readFile } from 'node:fs/promises';

import type { BattleSetup, PetId, Profile } from '@petbattle/core';
import type { AuthProvider } from '@petbattle/protocol';

import type {
  AccountRecord,
  AccountStatus,
  AuditEntry,
  BattleSessionRecord,
  SessionRecord,
  Store,
  StoredResponse,
} from './types.js';
import type { Queryable } from './pg-driver.js';

const BINDING_COLUMN: Record<AuthProvider, string> = {
  guest: 'guest_device_id',
  wechat: 'wechat_openid',
  steam: 'steam_id',
};

interface AccountRow {
  id: string;
  display_name: string;
  region: string;
  status: string;
  created_at: number;
  guest_device_id: string | null;
  wechat_openid: string | null;
  steam_id: string | null;
}

interface SessionRow {
  id: string;
  account_id: string;
  refresh_token_hash: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

interface ProfileRow {
  data: Profile;
}

interface StoredRow {
  status: number;
  body: unknown;
  fingerprint: string;
  created_at: number;
  expires_at: number;
}

interface BattleSessionRow {
  battle_id: string;
  account_id: string;
  stage_id: string;
  seed: number;
  setup: BattleSetup;
  party_pet_ids: PetId[];
  created_at: number;
  expires_at: number;
  status: string;
}

function toBattleSession(row: BattleSessionRow): BattleSessionRecord {
  return {
    battleId: row.battle_id,
    accountId: row.account_id,
    stageId: row.stage_id,
    seed: row.seed,
    setup: row.setup,
    partyPetIds: row.party_pet_ids,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status === 'claimed' ? 'claimed' : 'started',
  };
}

const ACCOUNT_STATUSES: readonly AccountStatus[] = ['active', 'banned', 'deleted'];

function toAccount(row: AccountRow): AccountRecord {
  const status = ACCOUNT_STATUSES.includes(row.status as AccountStatus)
    ? (row.status as AccountStatus)
    : 'active';

  return {
    id: row.id,
    displayName: row.display_name,
    region: row.region === 'global' ? 'global' : 'cn',
    status,
    createdAt: row.created_at,
    bindings: {
      guest: row.guest_device_id === null ? undefined : { deviceId: row.guest_device_id },
      wechat: row.wechat_openid === null ? undefined : { openid: row.wechat_openid },
      steam: row.steam_id === null ? undefined : { steamId: row.steam_id },
    },
  };
}

function toSession(row: SessionRow): SessionRecord {
  const session: SessionRecord = {
    id: row.id,
    accountId: row.account_id,
    refreshTokenHash: row.refresh_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  if (row.revoked_at !== null) session.revokedAt = row.revoked_at;
  return session;
}

export class PostgresStore implements Store {
  constructor(private readonly pool: Queryable & { end(): Promise<void> }) {}

  /**
   * 迁移：按文件名顺序执行，并用 `schema_migrations` 记录已应用的版本。
   * 不能每次启动都盲跑：含 `drop/alter` 的迁移重跑会清掉线上数据（本批实测踩到）。
   */
  async migrate(): Promise<void> {
    await this.pool.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at double precision not null
       )`,
    );

    const dir = new URL('./migrations/', import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();

    for (const file of files) {
      const applied = await this.pool.query('select 1 from schema_migrations where name = $1', [
        file,
      ]);
      if ((applied.rowCount ?? 0) > 0) continue;

      const sql = await readFile(new URL(file, dir), 'utf8');
      await this.pool.query(sql);
      await this.pool.query(
        `insert into schema_migrations (name, applied_at) values ($1, $2)
         on conflict (name) do nothing`,
        [file, Date.now()],
      );
    }
  }

  async findAccountByBinding(
    provider: AuthProvider,
    externalId: string,
  ): Promise<AccountRecord | undefined> {
    const column = BINDING_COLUMN[provider];
    const result = await this.pool.query<AccountRow>(
      `select * from accounts where ${column} = $1 limit 1`,
      [externalId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    const result = await this.pool.query<AccountRow>('select * from accounts where id = $1', [
      accountId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  async createAccount(account: AccountRecord): Promise<void> {
    await this.pool.query(
      `insert into accounts
         (id, display_name, region, status, created_at, guest_device_id, wechat_openid, steam_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        account.id,
        account.displayName,
        account.region,
        account.status,
        account.createdAt,
        account.bindings.guest?.deviceId ?? null,
        account.bindings.wechat?.openid ?? null,
        account.bindings.steam?.steamId ?? null,
      ],
    );
  }

  async updateAccountDisplayName(accountId: string, displayName: string): Promise<void> {
    await this.pool.query('update accounts set display_name = $2 where id = $1', [
      accountId,
      displayName,
    ]);
  }

  async getProfile(accountId: string): Promise<Profile | undefined> {
    const result = await this.pool.query<ProfileRow>(
      'select data from profiles where account_id = $1',
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : row.data;
  }

  async createProfile(profile: Profile): Promise<void> {
    await this.pool.query(
      `insert into profiles (account_id, revision, data, updated_at)
       values ($1, $2, $3::jsonb, $4)
       on conflict (account_id) do nothing`,
      [profile.accountId, profile.revision, JSON.stringify(profile), profile.lastEvaluatedAt],
    );
  }

  async saveProfile(profile: Profile, expectedRevision: number): Promise<boolean> {
    const result = await this.pool.query(
      `update profiles
          set revision = $2, data = $3::jsonb, updated_at = $4
        where account_id = $1 and revision = $5`,
      [profile.accountId, profile.revision, JSON.stringify(profile), profile.lastEvaluatedAt, expectedRevision],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.pool.query(
      `insert into sessions (id, account_id, refresh_token_hash, created_at, expires_at, revoked_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        session.accountId,
        session.refreshTokenHash,
        session.createdAt,
        session.expiresAt,
        session.revokedAt ?? null,
      ],
    );
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const result = await this.pool.query<SessionRow>('select * from sessions where id = $1', [
      sessionId,
    ]);
    const row = result.rows[0];
    return row === undefined ? undefined : toSession(row);
  }

  async revokeSession(sessionId: string, at: number): Promise<void> {
    await this.pool.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [
      sessionId,
      at,
    ]);
  }

  async getStoredResponse(
    scope: string,
    key: string,
    now: number,
  ): Promise<StoredResponse | undefined> {
    const result = await this.pool.query<StoredRow>(
      `select status, body, fingerprint, created_at, expires_at
         from idempotency_keys
        where scope = $1 and key = $2 and expires_at > $3`,
      [scope, key, now],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      status: row.status,
      body: row.body,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async putStoredResponse(scope: string, key: string, value: StoredResponse): Promise<void> {
    await this.pool.query(
      `insert into idempotency_keys (scope, key, fingerprint, status, body, created_at, expires_at)
       values ($1, $2, $3, $4, $5::json, $6, $7)
       on conflict (scope, key) do nothing`,
      [scope, key, value.fingerprint, value.status, JSON.stringify(value.body), value.createdAt, value.expiresAt],
    );
  }

  async createBattleSession(session: BattleSessionRecord): Promise<void> {
    await this.pool.query(
      `insert into battle_sessions
         (battle_id, account_id, stage_id, seed, setup, party_pet_ids, created_at, expires_at, status)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
      [
        session.battleId,
        session.accountId,
        session.stageId,
        session.seed,
        JSON.stringify(session.setup),
        JSON.stringify(session.partyPetIds),
        session.createdAt,
        session.expiresAt,
        session.status,
      ],
    );
  }

  async getBattleSession(battleId: string): Promise<BattleSessionRecord | undefined> {
    const result = await this.pool.query<BattleSessionRow>(
      'select * from battle_sessions where battle_id = $1',
      [battleId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toBattleSession(row);
  }

  async invalidateActiveBattleSessions(accountId: string, now: number): Promise<void> {
    await this.pool.query(
      `update battle_sessions
          set expires_at = $2
        where account_id = $1 and status = 'started' and expires_at > $2`,
      [accountId, now],
    );
  }

  async markBattleSessionClaimed(battleId: string, _now: number): Promise<boolean> {
    const result = await this.pool.query(
      `update battle_sessions
          set status = 'claimed'
        where battle_id = $1 and status = 'started'`,
      [battleId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `insert into audit_log (at, account_id, action, detail, request_id)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [
        entry.at,
        entry.accountId,
        entry.action,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
        entry.requestId ?? null,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
