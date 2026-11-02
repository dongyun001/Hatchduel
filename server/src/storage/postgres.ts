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

import type {
  BattleEvent,
  BattleSetup,
  BattleUnitInit,
  BattleWinner,
  Command,
  PetId,
  Profile,
} from '@petbattle/core';
import type { AuthProvider } from '@petbattle/protocol';

import type {
  AccountRecord,
  AccountStatus,
  AuditEntry,
  BattleSessionRecord,
  PvpDefenseRecord,
  PvpReplayRecord,
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

interface PvpDefenseRow {
  account_id: string;
  pet_ids: PetId[];
  units: BattleUnitInit[];
  content_version: string;
  created_at: number;
  expires_at: number;
}

interface PvpReplayRow {
  replay_id: string;
  attacker_id: string;
  defender_id: string;
  is_bot: boolean;
  season_id: string;
  content_version: string;
  setup: BattleSetup;
  seed: number;
  commands: Command[];
  events: BattleEvent[];
  winner: number | null;
  turns: number;
  attacker_rating_before: number;
  attacker_rating_after: number;
  defender_rating_before: number;
  defender_rating_after: number;
  created_at: number;
  expires_at: number;
}

function toPvpDefense(row: PvpDefenseRow): PvpDefenseRecord {
  return {
    accountId: row.account_id,
    petIds: row.pet_ids,
    units: row.units,
    contentVersion: row.content_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function toPvpReplay(row: PvpReplayRow): PvpReplayRecord {
  const winner: BattleWinner = row.winner === 0 || row.winner === 1 ? row.winner : null;
  return {
    replayId: row.replay_id,
    attackerId: row.attacker_id,
    defenderId: row.defender_id,
    isBot: row.is_bot,
    seasonId: row.season_id,
    contentVersion: row.content_version,
    setup: row.setup,
    seed: row.seed,
    commands: row.commands,
    events: row.events,
    winner,
    turns: row.turns,
    attackerRatingBefore: row.attacker_rating_before,
    attackerRatingAfter: row.attacker_rating_after,
    defenderRatingBefore: row.defender_rating_before,
    defenderRatingAfter: row.defender_rating_after,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
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

  async listAccounts(): Promise<AccountRecord[]> {
    const result = await this.pool.query<AccountRow>('select * from accounts order by id');
    return result.rows.map(toAccount);
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
      [
        profile.accountId,
        profile.revision,
        JSON.stringify(profile),
        profile.lastEvaluatedAt,
        expectedRevision,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listProfiles(): Promise<Profile[]> {
    const result = await this.pool.query<ProfileRow>('select data from profiles');
    return result.rows.map((row) => row.data);
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
    await this.pool.query(
      'update sessions set revoked_at = $2 where id = $1 and revoked_at is null',
      [sessionId, at],
    );
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
      [
        scope,
        key,
        value.fingerprint,
        value.status,
        JSON.stringify(value.body),
        value.createdAt,
        value.expiresAt,
      ],
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

  /**
   * 快照 + 存档同事务（F-01 一致性要求）。
   * 用单条 data-modifying CTE：`updated` 为空时 `snapshot` 不插入任何行，
   * 两条写要么一起生效、要么都不生效；不需要额外连接/事务管理。
   */
  async savePvpDefenseWithProfile(
    snapshot: PvpDefenseRecord,
    profile: Profile,
    expectedRevision: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `with updated as (
         update profiles
            set revision = $2, data = $3::jsonb, updated_at = $4
          where account_id = $1 and revision = $5
          returning account_id
       ), snapshot as (
         insert into pvp_defense_snapshots
           (account_id, pet_ids, units, content_version, created_at, expires_at)
         select $1, $6::jsonb, $7::jsonb, $8, $9, $10
           from updated
         on conflict (account_id) do update
           set pet_ids = excluded.pet_ids,
               units = excluded.units,
               content_version = excluded.content_version,
               created_at = excluded.created_at,
               expires_at = excluded.expires_at
         returning account_id
       )
       select account_id from updated`,
      [
        profile.accountId,
        profile.revision,
        JSON.stringify(profile),
        profile.lastEvaluatedAt,
        expectedRevision,
        JSON.stringify(snapshot.petIds),
        JSON.stringify(snapshot.units),
        snapshot.contentVersion,
        snapshot.createdAt,
        snapshot.expiresAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getPvpDefense(accountId: string): Promise<PvpDefenseRecord | undefined> {
    const result = await this.pool.query<PvpDefenseRow>(
      'select * from pvp_defense_snapshots where account_id = $1',
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toPvpDefense(row);
  }

  async listPvpDefenses(): Promise<PvpDefenseRecord[]> {
    const result = await this.pool.query<PvpDefenseRow>('select * from pvp_defense_snapshots');
    return result.rows.map(toPvpDefense);
  }

  async createPvpReplay(replay: PvpReplayRecord): Promise<void> {
    await this.pool.query(
      `insert into pvp_replays
         (replay_id, attacker_id, defender_id, is_bot, season_id, content_version, setup, seed,
          commands, events, winner, turns, attacker_rating_before, attacker_rating_after,
          defender_rating_before, defender_rating_after, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb,
               $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        replay.replayId,
        replay.attackerId,
        replay.defenderId,
        replay.isBot,
        replay.seasonId,
        replay.contentVersion,
        JSON.stringify(replay.setup),
        replay.seed,
        JSON.stringify(replay.commands),
        JSON.stringify(replay.events),
        replay.winner,
        replay.turns,
        replay.attackerRatingBefore,
        replay.attackerRatingAfter,
        replay.defenderRatingBefore,
        replay.defenderRatingAfter,
        replay.createdAt,
        replay.expiresAt,
      ],
    );
  }

  async getPvpReplay(replayId: string): Promise<PvpReplayRecord | undefined> {
    const result = await this.pool.query<PvpReplayRow>(
      'select * from pvp_replays where replay_id = $1',
      [replayId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toPvpReplay(row);
  }

  async listPvpReplaysByAttacker(accountId: string, since: number): Promise<PvpReplayRecord[]> {
    const result = await this.pool.query<PvpReplayRow>(
      `select * from pvp_replays
        where attacker_id = $1 and created_at >= $2
        order by created_at desc`,
      [accountId, since],
    );
    return result.rows.map(toPvpReplay);
  }

  async getDailyUsed(accountId: string, dayKey: string): Promise<number> {
    const result = await this.pool.query<{ used: number }>(
      'select used from pvp_daily_counters where account_id = $1 and day_key = $2',
      [accountId, dayKey],
    );
    return result.rows[0]?.used ?? 0;
  }

  async incrementDailyUsed(accountId: string, dayKey: string): Promise<number> {
    const result = await this.pool.query<{ used: number }>(
      `insert into pvp_daily_counters (account_id, day_key, used)
       values ($1, $2, 1)
       on conflict (account_id, day_key) do update
         set used = pvp_daily_counters.used + 1
       returning used`,
      [accountId, dayKey],
    );
    return result.rows[0]?.used ?? 1;
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
