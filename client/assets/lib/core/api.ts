// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * core 公共函数签名（TECH_DESIGN §7.2，DOMAIN_MODEL §7/§8/§9）。
 *
 * contract-v1 冻结：导出名、参数、返回类型不得改；需要改按 docs/CONTRACT.md §9.3 提请求。
 * 实现分散在 `src/*` 与 `src/battle/*`，本文件只保留签名与转发。
 */
import type { ConfigData, ConfigRepo, StageConfig } from './config/types';
import type { AncestorRef, Gender, Genome, HabitatId, PetId, PetInstance } from './types/pet';
import type { HabitatInstance, Profile, ProfilePatch, ResourceBag } from './types/profile';
import type { ElementId, EpochMs, Id, Rng } from './types/common';
import type { BattleSetup, BattleUnitInit, BattleEvent, BattleState, Command } from './types/battle';
import type { StatBlock } from './types/stats';

import { createConfigRepoImpl } from './config/repo';
import { deriveStatsImpl } from './stats';
import { advanceHabitatImpl, advancePetImpl, advanceProfileImpl } from './advance';
import { breedImpl, checkBreedingImpl, isInbredImpl } from './breeding';
import { startBreedingImpl } from './breeding-start';
import { claimBreedingImpl } from './breeding-claim';
import { applyPveRewardsImpl } from './pve-rewards';
import { applyProfilePatchImpl } from './profile-patch';
import { applyPvpOutcomeImpl, buildDefenseSnapshotImpl, buildPvpBattleSetupImpl } from './pvp';
import { createRng as createRngImpl } from './rng';
import { BattleReplayError } from './errors';
import { releasePetImpl } from './release';
import {
  cleanPetImpl,
  collectHabitatImpl,
  feedPetImpl,
  movePetToHabitatImpl,
  playWithPetImpl,
  upgradeHabitatImpl,
} from './habitat-ops';
import { createPetImpl } from './pet';
import { buildBattleSetupImpl, buildEnemyTeamImpl, buildPveBattleSetupImpl } from './battle/setup';
import {
  autoCommandImpl,
  availableCommandsImpl,
  createBattleContextImpl,
  submitCommandImpl,
  type BattleContext,
} from './battle/engine';

/** 建宠输入；正式 ID 由服务器生成（客户端可用临时 ID）。 */
export interface CreatePetInput {
  id: PetId;
  speciesId: Id;
  elementId: ElementId;
  genome: Genome;
  traits?: Id[];
  hiddenTraits?: Id[];
  gender: Gender;
  generation: number;
  parents?: [PetId | null, PetId | null];
  ancestors?: AncestorRef[];
  level?: number;
  now: EpochMs;
}

export interface AdvancePetResult {
  pet: PetInstance;
  changed: boolean;
}

export interface AdvanceHabitatResult {
  habitat: HabitatInstance;
  produced: ResourceBag;
}

export interface AdvanceProfileResult {
  profile: Profile;
  patch: ProfilePatch;
}

export type BreedError =
  | 'not_adult'
  | 'cooldown'
  | 'same_pet'
  | 'same_gender'
  | 'no_capacity'
  | 'cost'
  | 'locked'
  | 'infertile';

export interface BreedCheck {
  ok: boolean;
  reason?: BreedError;
  /** 双方 3 代内存在共同祖先；UI 必须警告。 */
  inbred: boolean;
}

export interface BreedResult {
  /** 子代，stage = 'egg'；结果在创建时即确定，不可重 roll。 */
  child: PetInstance;
  inbred: boolean;
  /**
   * 父母繁殖冷却到期时间，顺序与入参 `[a, b]` 一致（contract-v1.2 D-02）。
   * `cooldownMs × (1 + 近亲惩罚) × (老年 ×2)`；服务端直接写入，不再自行推算。
   */
  parentCooldowns: [EpochMs, EpochMs];
}

export interface ReleaseResult {
  profile: Profile;
  refund: ResourceBag;
}

/**
 * PvE 奖励（contract-v1.5）。唯一定义在 core，protocol 以 `BattleRewards` re-export。
 * `pets` 是首通直接发放的个体（以蛋阶段交付），repeat 不发。
 */
export interface PveRewards {
  resources?: ResourceBag;
  petExp?: number;
  pets?: PetInstance[];
  firstClear: boolean;
}

/** PvE 结算上下文（contract-v1.5 E-03/E-04）：`firstClear` 由服务端按 stageProgress 计算。 */
export interface PveRewardContext {
  firstClear: boolean;
  winner: 0 | 1 | null;
  /** 开战时的 lineup 快照；claim 时仍存在的队员才吃经验。 */
  partyPetIds: readonly PetId[];
  turns: number;
}

export interface PveRewardResult {
  profile: Profile;
  patch: ProfilePatch;
  rewards: PveRewards;
}

export interface ClaimBreedingResult {
  profile: Profile;
  patch: ProfilePatch;
  pet: PetInstance;
}

/** 繁殖编排结果（contract-v1.4 D-17）：`patch` 的 revision 保持输入值。 */
export interface StartBreedingResult {
  profile: Profile;
  patch: ProfilePatch;
  /** 新蛋（`stage = 'egg'`），同时已写入 `profile.pets` 与 `profile.breeding.eggs`。 */
  child: PetInstance;
  inbred: boolean;
  /** 父母冷却到期时间，顺序与入参 `[parentA, parentB]` 一致。 */
  parentCooldowns: [EpochMs, EpochMs];
}

/**
 * PvP 防守快照（contract-v1.6 F-01/F-09）。
 *
 * 只存 `units`（已定格的 `BattleUnitInit`），不存 `BattleSetup`：seed 每场由服务端生成。
 * `accountId` 由服务端落库时补上，core 不返回。过期快照仍可作为对战输入。
 */
export interface DefenseSnapshot {
  /** 1~3 只，顺序即出场顺序。 */
  petIds: PetId[];
  /** uid 固定 d0/d1/d2；`stats` 已含 deriveStats 结果。 */
  units: BattleUnitInit[];
  contentVersion: string;
  createdAt: EpochMs;
  /** createdAt + DEFENSE_SNAPSHOT_TTL_MS（24h）。 */
  expiresAt: EpochMs;
}

/**
 * PvP 结算输入（contract-v1.6 F-09）。`ratingAfter` 由服务端按 Elo 计算；
 * 机器人对局 `ranked = false`，此时 `ratingAfter` 必须等于存档当前 rating。
 */
export interface PvpOutcome {
  /** 攻方视角。 */
  result: 'win' | 'loss' | 'draw';
  /** 真人排位 = true；机器人对局 = false（rating 不变、ranked 不计数）。 */
  ranked: boolean;
  ratingAfter: number;
  seasonId: string;
}

export interface PvpOutcomeResult {
  profile: Profile;
  patch: ProfilePatch;
}

/**
 * 应用存档增量（contract-v1.4 D-16，PITFALLS P-047）。
 *
 * - `pets/habitats`：remove 优先于 upsert；
 * - `currencies`：patch 中出现的资源是绝对值，直接覆盖（不累加）；
 * - `codex`：只允许 false→true，`bestGene` 单调不减；
 * - 其余章节整体替换；`revision` 取 `patch.toRevision`，不校验 `fromRevision`。
 */
export function applyProfilePatch(profile: Profile, patch: ProfilePatch): Profile {
  return applyProfilePatchImpl(profile, patch);
}

/**
 * 构造确定性随机源（contract-v1.6 F-09，关闭 E-09）：固定 `mulberry32`。
 * 同一 seed 得到同一序列；服务端不要再自行实现一份 PRNG。
 */
export function createRng(seed: number): Rng {
  return createRngImpl(seed);
}

/**
 * 繁殖编排（contract-v1.4 D-17）：`checkBreeding` → 扣 `breeding.cost` → `breed` →
 * 落蛋 / 父母冷却 / `stats.breeds + 1`。失败抛 `BreedingError`（`reason` 复用 `BreedError`，
 * 父母不存在时为 `not_found`）。不推进时间；服务端先 `advanceProfile`。
 */
export function startBreeding(
  profile: Profile,
  parentAId: PetId,
  parentBId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
  rng: Rng,
): StartBreedingResult {
  return startBreedingImpl(profile, parentAId, parentBId, now, cfg, rng);
}
/**
 * PvE 奖励结算（contract-v1.5 E-03~E-06）：只有 `winner === 0` 发奖；失败/平局只记 `battlesLost`。
 * 首通宠物以蛋阶段直接进 `profile.pets`（不进 `breeding.eggs`）。不推进时间，patch revision 保持输入值。
 */
export function applyPveRewards(
  profile: Profile,
  stage: StageConfig,
  ctx: PveRewardContext,
  now: EpochMs,
  cfg: ConfigRepo,
): PveRewardResult {
  return applyPveRewardsImpl(profile, stage, ctx, now, cfg);
}

/**
 * 领取繁殖蛋（contract-v1.5 E-07）：从 `breeding.eggs` 出栏并返回个体；
 * 只允许已孵化（非蛋阶段）的宠物；不推进阶段、不推进时间。
 */
export function claimBreeding(
  profile: Profile,
  eggId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): ClaimBreedingResult {
  return claimBreedingImpl(profile, eggId, now, cfg);
}

/**
 * 按配置仓库构造只读配置索引；加载时校验（`validateConfig`）。
 * 失败时抛错，不做部分加载。
 */
export function createConfigRepo(data: ConfigData): ConfigRepo {
  return createConfigRepoImpl(data);
}

/**
 * 创建个体。派生属性不落库，按需 `deriveStats`。
 * 蛋阶段的 `fertility.readyAt` 按 hatch + juvenile 计算。
 *
 * 校验：species/element 必须存在；level 1~20 整数；基因取整并 clamp 0~100。
 */
export function createPet(input: CreatePetInput, cfg: ConfigRepo): PetInstance {
  return createPetImpl(input, cfg);
}

/**
 * 派生属性（DOMAIN_MODEL §4.1）：
 *
 * ```
 * 最终值 = floor(
 *   base × levelMul × stageMul × geneMul × condMul × traitMul × passiveMul × affinityMul
 * )
 * ```
 *
 * - levelMul/stageMul/geneMul/affinityMul 只作用于 hp/atk/def/spd；
 * - crit/critDmg/hit/dodge 只乘 condMul/traitMul/passiveMul；
 * - 相性在建战时修正基础属性，伤害公式里不再乘算（PITFALLS P-003 类推）；
 * - 全程 double，最后一次性 floor。
 */
export function deriveStats(pet: PetInstance, cfg: ConfigRepo): StatBlock {
  return deriveStatsImpl(pet, cfg);
}

/**
 * 推进单只宠物（阶段 → 状态 → 繁殖冷却）。输入 `(state, now)`，返回新状态 + 是否有变化。
 * 同一 `now` 重复调用不产生额外变化；`now` 早于内部时间戳抛 `TimeError('time_backwards')`。
 */
export function advancePet(
  pet: PetInstance,
  now: EpochMs,
  cfg: ConfigRepo,
): AdvancePetResult {
  return advancePetImpl(pet, now, cfg);
}

/**
 * 结算栖息地产出与消耗。产出用 `offlineCapMs`（默认 8h），状态衰减用 `decayCapMs`（默认 24h）。
 * 产出按 dtHours 线性插值，不足 10 分钟的零头保留；宠物数为 0 时产出为 0，不除以 0。
 */
export function advanceHabitat(
  habitat: HabitatInstance,
  pets: readonly PetInstance[],
  now: EpochMs,
  cfg: ConfigRepo,
): AdvanceHabitatResult {
  const result = advanceHabitatImpl(habitat, pets, now, cfg);
  return { habitat: result.habitat, produced: result.produced };
}

/**
 * 统一时间推进（AGENTS §3.4，DOMAIN_MODEL §7）：
 *
 * 1. 先推进宠物：阶段 → 状态 → 繁殖冷却；
 * 2. 再结算栖息地产出（使用推进后的状态）；
 * 3. 更新 `lastEvaluatedAt = now`，返回 `{ profile, patch }`。
 *
 * 顺序固定，不得交换；幂等；`now < lastEvaluatedAt` 抛 `TimeError('time_backwards')`。
 */
export function advanceProfile(
  profile: Profile,
  now: EpochMs,
  cfg: ConfigRepo,
): AdvanceProfileResult {
  return advanceProfileImpl(profile, now, cfg);
}

/**
 * 繁殖条件校验。顺序：同一只 → 性别 → 阶段 → 锁定 → 可繁殖时间 → 冷却 → 空位 → 成本。
 * 近亲不阻断繁殖，只在 `inbred` 标记并由 UI 警告。
 */
export function checkBreeding(
  a: PetInstance,
  b: PetInstance,
  now: EpochMs,
  profile: Profile,
  cfg: ConfigRepo,
): BreedCheck {
  return checkBreedingImpl(a, b, now, profile, cfg);
}

/**
 * 繁殖：物种 50/50；属性 50/50 + 1% 突变；基因 = 父母均值 + Irwin–Hall 波动；
 * 近亲 -5 基因 / +2% 突变 / 冷却 ×(1+penalty)；特质 3% 突变；性别随机；代数 = max+1。
 *
 * 只消费传入的 rng；调用顺序固定，不要在不同分支“多抽一次”。
 */
export function breed(
  a: PetInstance,
  b: PetInstance,
  now: EpochMs,
  cfg: ConfigRepo,
  rng: Rng,
): BreedResult {
  return breedImpl(a, b, now, cfg, rng);
}

/** 近亲判定：双方及 `maxDepth` 代内祖先是否有交集（默认 3 代）。 */
export function isInbred(a: PetInstance, b: PetInstance, maxDepth: number): boolean {
  return isInbredImpl(a, b, maxDepth);
}

/**
 * 放生。蛋 / 锁定 / 上阵 / 栖息地中 / 最后一只成年不可放生；返还基因尘；
 * 图鉴 owned 不回退；调用方写审计日志。
 *
 * contract-v1.2 D-01：`cfg` 必填，返还按 `economy.releaseRefund` 全量计算（含特质稀有加成）。
 */
export function releasePet(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): ReleaseResult {
  return releasePetImpl(profile, petId, now, cfg);
}

/**
 * 栖息地操作（contract-v1.3 D-12）。统一返回 `{ profile, patch }`；
 * `patch` 的 `fromRevision` 与 `toRevision` 都等于输入 `profile.revision`，由服务端统一 +1。
 * 失败抛 `Error`（`name = 'HabitatError'`，带 `code`，见 DOMAIN_MODEL §15.7）。
 */

/** 放入 / 移出栖息地；`habitatId = null` 表示移出。 */
export function movePetToHabitat(
  profile: Profile,
  petId: PetId,
  habitatId: HabitatId | null,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return movePetToHabitatImpl(profile, petId, habitatId, now, cfg);
}

/** 喂食：扣 `FoodConfig.cost`，恢复 hunger / mood。 */
export function feedPet(
  profile: Profile,
  petId: PetId,
  foodId: Id,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return feedPetImpl(profile, petId, foodId, now, cfg);
}

/** 清洁：恢复 hygiene（默认 +20），不消耗资源。 */
export function cleanPet(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return cleanPetImpl(profile, petId, now, cfg);
}

/** 陪玩：恢复 mood（默认 +20），不消耗资源。 */
export function playWithPet(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return playWithPetImpl(profile, petId, now, cfg);
}

/** 升级栖息地：扣配置成本、扩容量、重算 slots。 */
export function upgradeHabitat(
  profile: Profile,
  habitatId: HabitatId,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return upgradeHabitatImpl(profile, habitatId, now, cfg);
}

/** 领取产出：`stored` 转入 `currencies`（货币取整，零头留在 stored）。 */
export function collectHabitat(
  profile: Profile,
  habitatId: HabitatId,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  return collectHabitatImpl(profile, habitatId, now, cfg);
}

/**
 * 用个体快照构建 3v3 战斗输入。`teams[0]` 为主队/攻方，`teams[1]` 为敌方/守方。
 * uid 由本函数生成（"a0"/"b0"）；不读全局状态；同一输入必须得到同一输出。
 */
export function buildBattleSetup(
  teams: readonly [readonly PetInstance[], readonly PetInstance[]],
  cfg: ConfigRepo,
  seed: number,
): BattleSetup {
  return buildBattleSetupImpl(teams, cfg, seed);
}

/**
 * 由关卡配置确定性生成敌方队伍（DOMAIN_MODEL §9.4）：
 * 同一 stage/seed 必须得到同一队伍；敌方按满状态；技能固定为
 * [普攻, 属性小技能, 属性大招, 物种技能]。
 */
export function buildEnemyTeam(
  stage: StageConfig,
  cfg: ConfigRepo,
  seed: number,
): BattleUnitInit[] {
  return buildEnemyTeamImpl(stage, cfg, seed);
}

/**
 * PvE 战斗输入（contract-v1.3 D-10）：`team0` = 玩家队伍（uid `a*`），
 * `team1` = 关卡敌方（uid `b*`）。同一 `(party, stage, seed)` 必然得到同一输出。
 */
export function buildPveBattleSetup(
  party: readonly PetInstance[],
  stage: StageConfig,
  cfg: ConfigRepo,
  seed: number,
): BattleSetup {
  return buildPveBattleSetupImpl(party, stage, cfg, seed);
}

/**
 * 构建 PvP 防守快照（contract-v1.6 F-09）：把本人宠物定格为 `BattleUnitInit[]`。
 *
 * - `petIds` 1~3 只、不重复、存在、非蛋；失败抛 `DefenseError`（服务端映射 `INVALID_LINEUP`）；
 * - uid 固定 `d0/d1/d2`；`stats`/`skills`/`traits`/`passiveId` 与 `buildBattleSetup` 同口径；
 * - `expiresAt = now + DEFENSE_SNAPSHOT_TTL_MS`；纯函数，不改 `profile`。
 */
export function buildDefenseSnapshot(
  profile: Profile,
  petIds: readonly PetId[],
  now: EpochMs,
  cfg: ConfigRepo,
): DefenseSnapshot {
  return buildDefenseSnapshotImpl(profile, petIds, now, cfg);
}

/**
 * 构建 PvP 战斗输入（contract-v1.6 F-09）：`team0` = 攻方（uid `a*`），
 * `team1` = 防守快照（uid 重排为 `b*`）。双方都必须 1~3 只；不改入参数组。
 */
export function buildPvpBattleSetup(
  attackerPets: readonly PetInstance[],
  defenseUnits: readonly BattleUnitInit[],
  cfg: ConfigRepo,
  seed: number,
): BattleSetup {
  return buildPvpBattleSetupImpl(attackerPets, defenseUnits, cfg, seed);
}

/**
 * 应用异步 PvP 结算（contract-v1.6 F-09）：只改 `pvp` / `stats`，不推进时间。
 *
 * - `ranked=true`：写入 `ratingAfter`，`pvp.ranked` 对应结果 +1；
 * - `ranked=false`：rating 保持原值（`ratingAfter` 不等时抛错），`ranked` 不计数；
 * - `stats.battlesWon/Lost` 按 `result` 计，平局不计；`pvp.seasonId` 写入 `outcome.seasonId`；
 * - `patch.fromRevision = patch.toRevision = profile.revision`，`lastEvaluatedAt` 不变。
 */
export function applyPvpOutcome(profile: Profile, outcome: PvpOutcome): PvpOutcomeResult {
  return applyPvpOutcomeImpl(profile, outcome);
}

/**
 * 回合制战斗引擎（DOMAIN_MODEL §9.3）。内部持有状态；`state` 返回只读快照。
 *
 * 指令驱动：`submit` 每次推进当前行动者的一个动作，返回本步事件；
 * 回合切换（精力 +20、DOT、buff 计时、重排）并入同一次返回。
 */
export class BattleEngine {
  private readonly ctx: BattleContext;

  private constructor(ctx: BattleContext) {
    this.ctx = ctx;
  }

  static create(setup: BattleSetup, cfg: ConfigRepo): BattleEngine {
    return new BattleEngine(createBattleContextImpl(setup, cfg));
  }

  /** 当前可提交的指令（按回合/存活/精力/目标校验）。 */
  availableCommands(uid: string): Command[] {
    return availableCommandsImpl(this.ctx, uid);
  }

  /**
   * 内置确定性 AI 给当前行动者选一条指令（contract-v1.2 D-03）。
   * 与引擎内部 AI 同一份策略；未轮到 `uid` 或战斗已结束时抛错。
   */
  autoCommand(uid: string): Command {
    return autoCommandImpl(this.ctx, uid);
  }

  /** 提交一条指令，返回本步产生的有序事件。 */
  submit(cmd: Command): BattleEvent[] {
    return submitCommandImpl(this.ctx, cmd);
  }

  get state(): Readonly<BattleState> {
    return this.ctx.state;
  }
}

/**
 * 从零重放一场战斗（contract-v1.5 E-02）：`setup + seed + commands` 必须能跑完。
 * - 指令非法（回合不符 / 不是当前行动者 / 目标或精力不合法）→ `BattleReplayError('invalid_command')`；
 * - 指令用尽仍未结束 → `BattleReplayError('not_finished')`；
 * - 结束后多余的指令忽略；始终受 30 回合上限约束。
 */
export function runBattle(
  setup: BattleSetup,
  cfg: ConfigRepo,
  commands: readonly Command[],
): { winner: 0 | 1 | null; turns: number; events: BattleEvent[] } {
  const engine = BattleEngine.create(setup, cfg);

  for (const command of commands) {
    if (engine.state.phase === 'finished') break;
    try {
      engine.submit(command);
    } catch {
      throw new BattleReplayError('invalid_command');
    }
  }

  if (engine.state.phase !== 'finished') throw new BattleReplayError('not_finished');

  return {
    winner: engine.state.winner,
    turns: engine.state.turn,
    events: [...engine.state.log],
  };
}
