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
import type { BattleSetup, Id, PetId, Profile } from '@petbattle/core';
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

  // PvE 战斗会话（contract-v1.5 E-01）
  createBattleSession(session: BattleSessionRecord): Promise<void>;
  getBattleSession(battleId: string): Promise<BattleSessionRecord | undefined>;
  /** 让该账号所有未结束会话立即失效（expiresAt = now）；`start` 新会话前调用。 */
  invalidateActiveBattleSessions(accountId: string, now: number): Promise<void>;
  /** `started → claimed` 的 CAS；返回 false 表示已被领取或不存在。 */
  markBattleSessionClaimed(battleId: string, now: number): Promise<boolean>;

  // 审计
  appendAudit(entry: AuditEntry): Promise<void>;

  close(): Promise<void>;
}

/** PvE 会话状态；过期不改状态，靠 `expiresAt` 判定（claim 时返回 BATTLE_EXPIRED）。 */
export type BattleSessionStatus = 'started' | 'claimed';

/**
 * PvE 战斗会话（CONTRACT §7.4 E-01）。
 *
 * `setup` 是开战时的完整快照（含 seed）：claim 时用它从零重放，绝不引用实时宠物/配置，
 * 避免“改了宠物或配置导致旧战报漂移”（PITFALLS P-027）。`partyPetIds` 用于发经验（E-04）。
 */
export interface BattleSessionRecord {
  battleId: string;
  accountId: string;
  stageId: Id;
  seed: number;
  setup: BattleSetup;
  partyPetIds: PetId[];
  createdAt: number;
  /** 默认 now + 30 分钟；过期后 claim 返回 BATTLE_EXPIRED。 */
  expiresAt: number;
  status: BattleSessionStatus;
}
