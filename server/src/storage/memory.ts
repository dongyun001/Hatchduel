/**
 * 内存存储：测试与无数据库本地开发的默认实现。
 *
 * 关键约束：
 * - 所有读写出入都做深拷贝，调用方修改返回值不会污染存储（避免“改了没落库却生效”的假象）；
 * - `saveProfile` 做 revision CAS；
 * - 每个绑定（provider + externalId）只能指向一个账号。
 *
 * 容量：审计日志只保留最近 5000 条；这是测试/开发实现，生产用 Postgres。
 */
import type { Profile } from '@petbattle/core';
import type { AuthProvider } from '@petbattle/protocol';

import type {
  AccountRecord,
  AuditEntry,
  BattleSessionRecord,
  SessionRecord,
  Store,
  StoredResponse,
} from './types.js';

const AUDIT_LIMIT = 5000;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function bindingKey(provider: AuthProvider, externalId: string): string {
  return `${provider}:${externalId}`;
}

function idempotencyKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`;
}

export class InMemoryStore implements Store {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly bindings = new Map<string, string>();
  private readonly profiles = new Map<string, Profile>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly battleSessions = new Map<string, BattleSessionRecord>();
  private readonly idempotency = new Map<string, StoredResponse>();
  private readonly audits: AuditEntry[] = [];

  async findAccountByBinding(
    provider: AuthProvider,
    externalId: string,
  ): Promise<AccountRecord | undefined> {
    const accountId = this.bindings.get(bindingKey(provider, externalId));
    if (accountId === undefined) return undefined;
    const account = this.accounts.get(accountId);
    return account === undefined ? undefined : clone(account);
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    const account = this.accounts.get(accountId);
    return account === undefined ? undefined : clone(account);
  }

  async createAccount(account: AccountRecord): Promise<void> {
    if (this.accounts.has(account.id)) {
      throw new Error(`账号已存在：${account.id}`);
    }
    for (const [provider, binding] of Object.entries(account.bindings)) {
      const externalId = readExternalId(binding);
      if (externalId === undefined) continue;
      const key = bindingKey(provider as AuthProvider, externalId);
      if (this.bindings.has(key)) {
        throw new Error(`绑定已存在：${key}`);
      }
      this.bindings.set(key, account.id);
    }
    this.accounts.set(account.id, clone(account));
  }

  async updateAccountDisplayName(accountId: string, displayName: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (account === undefined) throw new Error(`账号不存在：${accountId}`);
    account.displayName = displayName;
  }

  async getProfile(accountId: string): Promise<Profile | undefined> {
    const profile = this.profiles.get(accountId);
    return profile === undefined ? undefined : clone(profile);
  }

  async createProfile(profile: Profile): Promise<void> {
    if (this.profiles.has(profile.accountId)) return;
    this.profiles.set(profile.accountId, clone(profile));
  }

  async saveProfile(profile: Profile, expectedRevision: number): Promise<boolean> {
    const current = this.profiles.get(profile.accountId);
    if (current === undefined) return false;
    if (current.revision !== expectedRevision) return false;
    this.profiles.set(profile.accountId, clone(profile));
    return true;
  }

  async createSession(session: SessionRecord): Promise<void> {
    if (this.sessions.has(session.id)) throw new Error(`会话已存在：${session.id}`);
    this.sessions.set(session.id, clone(session));
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? undefined : clone(session);
  }

  async revokeSession(sessionId: string, at: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    session.revokedAt = at;
  }

  async getStoredResponse(
    scope: string,
    key: string,
    now: number,
  ): Promise<StoredResponse | undefined> {
    const stored = this.idempotency.get(idempotencyKey(scope, key));
    if (stored === undefined) return undefined;
    if (stored.expiresAt <= now) {
      this.idempotency.delete(idempotencyKey(scope, key));
      return undefined;
    }
    return clone(stored);
  }

  async putStoredResponse(scope: string, key: string, value: StoredResponse): Promise<void> {
    const internalKey = idempotencyKey(scope, key);
    if (this.idempotency.has(internalKey)) return;
    this.idempotency.set(internalKey, clone(value));
  }

  async createBattleSession(session: BattleSessionRecord): Promise<void> {
    if (this.battleSessions.has(session.battleId)) {
      throw new Error(`战斗会话已存在：${session.battleId}`);
    }
    this.battleSessions.set(session.battleId, clone(session));
  }

  async getBattleSession(battleId: string): Promise<BattleSessionRecord | undefined> {
    const session = this.battleSessions.get(battleId);
    return session === undefined ? undefined : clone(session);
  }

  /** 让账号下所有未结束会话立即失效：把 expiresAt 压到 now，claim 时按过期处理。 */
  async invalidateActiveBattleSessions(accountId: string, now: number): Promise<void> {
    for (const session of this.battleSessions.values()) {
      if (session.accountId !== accountId) continue;
      if (session.status !== 'started') continue;
      if (session.expiresAt > now) session.expiresAt = now;
    }
  }

  async markBattleSessionClaimed(battleId: string, _now: number): Promise<boolean> {
    const session = this.battleSessions.get(battleId);
    if (session === undefined || session.status !== 'started') return false;
    session.status = 'claimed';
    return true;
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.audits.push(clone(entry));
    if (this.audits.length > AUDIT_LIMIT) {
      this.audits.splice(0, this.audits.length - AUDIT_LIMIT);
    }
  }

  /** 测试用：读取审计记录。 */
  listAudits(): AuditEntry[] {
    return clone(this.audits);
  }

  async close(): Promise<void> {
    // 无资源需要释放。
  }
}

function readExternalId(binding: unknown): string | undefined {
  if (typeof binding !== 'object' || binding === null) return undefined;
  const record = binding as Record<string, unknown>;
  for (const key of ['deviceId', 'openid', 'steamId']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}
