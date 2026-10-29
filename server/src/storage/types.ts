/**
 * 存储抽象（TECH_DESIGN §5.4：数据库访问集中在 storage/）。
 *
 * 一个 `Store` 覆盖账号、存档、会话、幂等、审计。内存实现用于测试与无数据库的本地开发；
 * Postgres 实现是 Demo 部署形态（2C2G：单实例、连接池 ≤20）。
 *
 * 写入语义：
 * - `saveProfile` 必须做 revision CAS，返回 false 表示冲突，由服务层转 `REVISION_CONFLICT`；
 * - 幂等结果按 `(scope, key)` 唯一，scope 是 accountId 或 `device:<deviceId>`。
 */
import type { Profile } from '@petbattle/core';
import type { AccountBindings, AuthProvider } from '@petbattle/protocol';

export type AccountStatus = 'active' | 'banned' | 'deleted';

export interface AccountRecord {
  id: string;
  displayName: string;
  region: 'cn' | 'global';
  status: AccountStatus;
  createdAt: number;
  bindings: AccountBindings;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  /** refresh token 的 sha256，不存明文。 */
  refreshTokenHash: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface StoredResponse {
  status: number;
  body: unknown;
  /** 请求指纹：同 key 不同请求 → IDEMPOTENCY_CONFLICT。 */
  fingerprint: string;
  createdAt: number;
  expiresAt: number;
}

export interface AuditEntry {
  at: number;
  accountId: string;
  action: string;
  detail?: unknown;
  requestId?: string;
}

export type CreateProfileResult = 'created' | 'exists';

export interface Store {
  // 账号
  findAccountByBinding(provider: AuthProvider, externalId: string): Promise<AccountRecord | undefined>;
  getAccount(accountId: string): Promise<AccountRecord | undefined>;
  createAccount(account: AccountRecord): Promise<void>;
  updateAccountDisplayName(accountId: string, displayName: string): Promise<void>;

  // 存档
  getProfile(accountId: string): Promise<Profile | undefined>;
  createProfile(profile: Profile): Promise<void>;
  /** revision CAS 写入；返回 false 表示期望版本已过期。 */
  saveProfile(profile: Profile, expectedRevision: number): Promise<boolean>;

  // 会话
  createSession(session: SessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  revokeSession(sessionId: string, at: number): Promise<void>;

  // 幂等（按 scope + key 去重）
  getStoredResponse(scope: string, key: string, now: number): Promise<StoredResponse | undefined>;
  putStoredResponse(scope: string, key: string, value: StoredResponse): Promise<void>;

  // 审计
  appendAudit(entry: AuditEntry): Promise<void>;

  close(): Promise<void>;
}

/**
 * 异步 PvP 战斗会话（CONTRACT §10.2 / `claimPveBattle` 重放模型）。
 *
 * M1 只落库接口与表结构，不实现：先存 `battleId → setup/seed`，未来按重放校验。
 * PvP 模拟必须走 `Semaphore` 限并发（TECH_DESIGN §16.1）。
 */
export interface BattleSessionRecord {
  id: string;
  accountId: string;
  kind: 'pve' | 'pvp';
  seed: number;
  /** `BattleSetup` 的序列化快照；引用可变数据会导致旧战报漂移（PITFALLS P-027）。 */
  setup: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface BattleSessionStore {
  createBattleSession(session: BattleSessionRecord): Promise<void>;
  getBattleSession(id: string): Promise<BattleSessionRecord | undefined>;
}
