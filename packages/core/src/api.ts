/**
 * core 公共函数签名（TECH_DESIGN §7.2，DOMAIN_MODEL §7/§8/§9）。
 *
 * contract-v1 冻结：导出名、参数、返回类型不得改；需要改按 docs/CONTRACT.md §9.3 提请求。
 * 实现分散在 `src/*` 与 `src/battle/*`，本文件只保留签名与转发。
 */
import type { ConfigData, ConfigRepo, StageConfig } from './config/types.js';
import type { AncestorRef, Gender, Genome, PetId, PetInstance } from './types/pet.js';
import type { HabitatInstance, Profile, ProfilePatch, ResourceBag } from './types/profile.js';
import type { ElementId, EpochMs, Id, Rng } from './types/common.js';
import type { BattleSetup, BattleUnitInit, BattleEvent, BattleState, Command } from './types/battle.js';
import type { StatBlock } from './types/stats.js';

import { createConfigRepoImpl } from './config/repo.js';
import { CoreNotImplementedError } from './errors.js';
import { deriveStatsImpl } from './stats.js';
import { advanceHabitatImpl, advancePetImpl, advanceProfileImpl } from './advance.js';
import { breedImpl, checkBreedingImpl, isInbredImpl } from './breeding.js';
import { releasePetImpl } from './release.js';
import { buildBattleSetupImpl, buildEnemyTeamImpl } from './battle/setup.js';
import {
  availableCommandsImpl,
  createBattleContextImpl,
  submitCommandImpl,
  type BattleContext,
} from './battle/engine.js';

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
}

export interface ReleaseResult {
  profile: Profile;
  refund: ResourceBag;
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
 * 尚未实现（M0 契约桩）：`createPet` 不在首批范围内。
 */
export function createPet(input: CreatePetInput, cfg: ConfigRepo): PetInstance {
  void input;
  void cfg;
  throw new CoreNotImplementedError('createPet');
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
 */
export function releasePet(profile: Profile, petId: PetId, now: EpochMs): ReleaseResult {
  return releasePetImpl(profile, petId, now);
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

  /** 提交一条指令，返回本步产生的有序事件。 */
  submit(cmd: Command): BattleEvent[] {
    return submitCommandImpl(this.ctx, cmd);
  }

  get state(): Readonly<BattleState> {
    return this.ctx.state;
  }
}
