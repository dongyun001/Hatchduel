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
import type {
  BattleEvent,
  BattleSetup,
  BattleUnitInit,
  BattleWinner,
  Command,
  Id,
  PetId,
  Profile,
} from '@petbattle/core';
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
  findAccountByBinding(
    provider: AuthProvider,
    externalId: string,
  ): Promise<AccountRecord | undefined>;
  getAccount(accountId: string): Promise<AccountRecord | undefined>;
  createAccount(account: AccountRecord): Promise<void>;
  updateAccountDisplayName(accountId: string, displayName: string): Promise<void>;
  /** 排行榜/匹配需要扫描全量账号；Demo 数据量下可接受。 */
  listAccounts(): Promise<AccountRecord[]>;

  // 存档
  getProfile(accountId: string): Promise<Profile | undefined>;
  createProfile(profile: Profile): Promise<void>;
  /** revision CAS 写入；返回 false 表示期望版本已过期。 */
  saveProfile(profile: Profile, expectedRevision: number): Promise<boolean>;
  /** 排行榜候选：Demo 阶段一次扫描全部存档。 */
  listProfiles(): Promise<Profile[]>;

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

  // 异步 PvP（contract-v1.6 F-01/F-03）
  /** 设置防守：快照与 profile 的 revision CAS 必须原子成功或同时失败。 */
  savePvpDefenseWithProfile(
    snapshot: PvpDefenseRecord,
    profile: Profile,
    expectedRevision: number,
  ): Promise<boolean>;
  getPvpDefense(accountId: string): Promise<PvpDefenseRecord | undefined>;
  /** 全量防守快照；匹配时再按账号状态/自身过滤。 */
  listPvpDefenses(): Promise<PvpDefenseRecord[]>;
  createPvpReplay(replay: PvpReplayRecord): Promise<void>;
  getPvpReplay(replayId: string): Promise<PvpReplayRecord | undefined>;
  /** 某攻方在 `since` 之后的战报（匹配排除最近对手）。 */
  listPvpReplaysByAttacker(accountId: string, since: number): Promise<PvpReplayRecord[]>;

  // 每日挑战次数（Asia/Shanghai 00:00 切日）
  getDailyUsed(accountId: string, dayKey: string): Promise<number>;
  /** 原子 +1 并返回新值；只有成功落库的 fight 才调用。 */
  incrementDailyUsed(accountId: string, dayKey: string): Promise<number>;

  // 审计
  appendAudit(entry: AuditEntry): Promise<void>;

  close(): Promise<void>;
}

/**
 * PvP 防守快照（CONTRACT §7.5 F-01）。
 *
 * 存 `BattleUnitInit[]` 而不是 `BattleSetup`：seed 每场由服务端生成。
 * 配置变更/升级/放生都不回溯修改旧快照（PITFALLS P-027）。
 */
export interface PvpDefenseRecord {
  accountId: string;
  petIds: PetId[];
  units: BattleUnitInit[];
  contentVersion: string;
  createdAt: number;
  expiresAt: number;
}

/** PvP 战报（CONTRACT §7.5 F-03/F-06）：events 为准，setup+seed+commands 只用于复算。 */
export interface PvpReplayRecord {
  replayId: string;
  attackerId: string;
  defenderId: string;
  isBot: boolean;
  seasonId: string;
  /** 产生该战报的 core / 配置版本；回放 `BattleReplay.version` 取它。 */
  contentVersion: string;
  setup: BattleSetup;
  seed: number;
  commands: Command[];
  events: BattleEvent[];
  winner: BattleWinner;
  turns: number;
  attackerRatingBefore: number;
  attackerRatingAfter: number;
  defenderRatingBefore: number;
  defenderRatingAfter: number;
  createdAt: number;
  expiresAt: number;
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
