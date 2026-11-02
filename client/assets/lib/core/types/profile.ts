// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/** 资源、栖息地与存档（DOMAIN_MODEL §6、§10、§11）。 */
import type { EpochMs, Id, ResourceId } from './common';
import type { HabitatId, PetId, PetInstance } from './pet';

export type ResourceBag = Partial<Record<ResourceId, number>>;

export interface ResourceCost {
  resource: ResourceId;
  amount: number;
}

export interface ResourceRate {
  resource: ResourceId;
  amountPerHour: number;
}

/** `${speciesId}:${elementId}`。 */
export type CodexKey = `${string}:${string}`;

export interface CodexEntry {
  seen: boolean;
  owned: boolean;
  /** 四项基因均值 0~100。 */
  bestGene: number;
}

export interface StageProgress {
  cleared: boolean;
  bestTurns?: number;
  firstClearAt?: EpochMs;
}

export interface BreedingState {
  eggs: PetId[];
  cooldowns: Record<PetId, EpochMs>;
}

export interface PvpState {
  /** 防守阵容；与 `Profile.lineup`（出战编队）互不联动。 */
  defense: PetId[];
  rating: number;
  seasonId: string;
  /**
   * 真人排位战绩（contract-v1.6 F-09）；机器人对局不计。
   * 缺省视为 0 场，旧存档无需迁移。
   */
  ranked?: { wins: number; losses: number; draws: number };
}

export interface ProfileSettings {
  sfx: boolean;
  bgm: boolean;
}

export interface ProfileStats {
  battlesWon: number;
  battlesLost: number;
  breeds: number;
  hatchlings: number;
  mutations: number;
  released: number;
}

export interface HabitatInstance {
  id: HabitatId;
  configId: Id;
  level: number;
  /** 长度 = 该等级容量；一个宠物只能占一个槽位。 */
  slots: Array<PetId | null>;
  lastEvaluatedAt: EpochMs;
  /** 未领取的产出。 */
  stored: ResourceBag;
}

/**
 * 服务器权威存档。
 * `revision` 每次写操作 +1；客户端只缓存用于展示。
 */
export interface Profile {
  /** 存档结构版本。 */
  version: number;
  accountId: string;
  revision: number;
  createdAt: EpochMs;
  lastEvaluatedAt: EpochMs;

  currencies: Record<ResourceId, number>;
  pets: Record<PetId, PetInstance>;
  habitats: Record<HabitatId, HabitatInstance>;

  codex: Record<CodexKey, CodexEntry>;

  /** 出战编队，最多 3 只；与 PvP 防守阵容分离。 */
  lineup: PetId[];
  stageProgress: Record<Id, StageProgress>;

  breeding: BreedingState;
  pvp: PvpState;

  settings: ProfileSettings;
  stats: ProfileStats;
}

/**
 * 存档增量。由 core 计算、服务端落库后随响应下发；
 * 客户端按 `fromRevision → toRevision` 合并，不自行推导结果。
 */
export interface ProfilePatch {
  fromRevision: number;
  toRevision: number;
  at: EpochMs;
  lastEvaluatedAt: EpochMs;
  currencies?: ResourceBag;
  pets?: {
    upsert?: PetInstance[];
    remove?: PetId[];
  };
  habitats?: {
    upsert?: HabitatInstance[];
    remove?: HabitatId[];
  };
  codex?: Record<CodexKey, CodexEntry>;
  lineup?: PetId[];
  stageProgress?: Record<Id, StageProgress>;
  breeding?: BreedingState;
  pvp?: PvpState;
  settings?: ProfileSettings;
  stats?: ProfileStats;
}
