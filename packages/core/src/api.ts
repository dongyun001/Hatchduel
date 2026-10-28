/**
 * core 公共函数签名（TECH_DESIGN §7.2，DOMAIN_MODEL §7/§8/§9）。
 *
 * M0 只冻结签名：除 `expToNext` 与 `validateConfig` 外一律抛 `CoreNotImplementedError`。
 * 实现由 A 会话负责；改动签名等同改契约，需升版本并通知 B/C/D。
 */
import type { ConfigData, ConfigRepo, StageConfig } from './config/types.js';
import { CoreNotImplementedError } from './errors.js';
import type { AncestorRef, Gender, Genome, PetId, PetInstance } from './types/pet.js';
import type { HabitatInstance, Profile, ProfilePatch, ResourceBag } from './types/profile.js';
import type { ElementId, EpochMs, Id, Rng } from './types/common.js';
import type { BattleSetup, BattleUnitInit, BattleEvent, BattleState, Command } from './types/battle.js';
import type { StatBlock } from './types/stats.js';

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

function notImplemented(fn: string): never {
  throw new CoreNotImplementedError(fn);
}

/**
 * 按配置仓库构造只读配置索引；加载时校验（`validateConfig`）。
 * 失败时抛错，不做部分加载。
 */
export function createConfigRepo(_data: ConfigData): ConfigRepo {
  return notImplemented('createConfigRepo');
}

/**
 * 创建个体。派生属性不落库，按需 `deriveStats`。
 * 蛋阶段的 `fertility.readyAt` 按 hatch + juvenile 计算。
 */
export function createPet(_input: CreatePetInput, _cfg: ConfigRepo): PetInstance {
  return notImplemented('createPet');
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
export function deriveStats(_pet: PetInstance, _cfg: ConfigRepo): StatBlock {
  return notImplemented('deriveStats');
}

/**
 * 推进单只宠物（阶段 → 状态 → 繁殖冷却）。输入 `(state, now)`，返回新状态 + 是否有变化。
 * 同一 `now` 重复调用不产生额外变化；`now` 早于内部时间戳抛 `TimeError('time_backwards')`。
 */
export function advancePet(
  _pet: PetInstance,
  _now: EpochMs,
  _cfg: ConfigRepo,
): AdvancePetResult {
  return notImplemented('advancePet');
}

/**
 * 结算栖息地产出与消耗。产出用 `offlineCapMs`（默认 8h），状态衰减用 `decayCapMs`（默认 24h）。
 * 产出按 dtHours 线性插值，不足 10 分钟的零头保留；宠物数为 0 时产出为 0，不除以 0。
 */
export function advanceHabitat(
  _habitat: HabitatInstance,
  _pets: readonly PetInstance[],
  _now: EpochMs,
  _cfg: ConfigRepo,
): AdvanceHabitatResult {
  return notImplemented('advanceHabitat');
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
  _profile: Profile,
  _now: EpochMs,
  _cfg: ConfigRepo,
): AdvanceProfileResult {
  return notImplemented('advanceProfile');
}

/**
 * 繁殖条件校验。顺序：同一只 → 性别 → 阶段 → 锁定 → 可繁殖时间 → 冷却 → 空位 → 成本。
 * 近亲不阻断繁殖，只在 `inbred` 标记并由 UI 警告。
 */
export function checkBreeding(
  _a: PetInstance,
  _b: PetInstance,
  _now: EpochMs,
  _profile: Profile,
  _cfg: ConfigRepo,
): BreedCheck {
  return notImplemented('checkBreeding');
}

/**
 * 繁殖：物种 50/50；属性 50/50 + 1% 突变；基因 = 父母均值 + Irwin–Hall 波动；
 * 近亲 -5 基因 / +2% 突变 / 冷却 ×(1+penalty)；特质 3% 突变；性别随机；代数 = max+1。
 *
 * 只消费传入的 rng；调用顺序固定，不要在不同分支“多抽一次”。
 */
export function breed(
  _a: PetInstance,
  _b: PetInstance,
  _now: EpochMs,
  _cfg: ConfigRepo,
  _rng: Rng,
): BreedResult {
  return notImplemented('breed');
}

/** 近亲判定：双方及 `maxDepth` 代内祖先是否有交集（默认 3 代）。 */
export function isInbred(_a: PetInstance, _b: PetInstance, _maxDepth: number): boolean {
  return notImplemented('isInbred');
}

/**
 * 放生。蛋 / 锁定 / 上阵 / 栖息地中 / 最后一只成年不可放生；返还基因尘；
 * 图鉴 owned 不回退；调用方写审计日志。
 */
export function releasePet(_profile: Profile, _petId: PetId, _now: EpochMs): ReleaseResult {
  return notImplemented('releasePet');
}

/**
 * 用个体快照构建 3v3 战斗输入。`teams[0]` 为主队/攻方，`teams[1]` 为敌方/守方。
 * uid 由本函数生成（"a0"/"b0"）；不读全局状态；同一输入必须得到同一输出。
 */
export function buildBattleSetup(
  _teams: readonly [readonly PetInstance[], readonly PetInstance[]],
  _cfg: ConfigRepo,
  _seed: number,
): BattleSetup {
  return notImplemented('buildBattleSetup');
}

/**
 * 由关卡配置确定性生成敌方队伍（DOMAIN_MODEL §9.4）：
 * 同一 stage/seed 必须得到同一队伍；敌方按满状态；技能固定为
 * [普攻, 属性小技能, 属性大招, 物种技能]。
 */
export function buildEnemyTeam(
  _stage: StageConfig,
  _cfg: ConfigRepo,
  _seed: number,
): BattleUnitInit[] {
  return notImplemented('buildEnemyTeam');
}

/**
 * 回合制战斗引擎（DOMAIN_MODEL §9.3）。内部持有状态；`state` 返回只读快照。
 */
export class BattleEngine {
  static create(_setup: BattleSetup, _cfg: ConfigRepo): BattleEngine {
    return notImplemented('BattleEngine.create');
  }

  /** 当前可提交的指令（按回合/存活/精力/目标校验）。 */
  availableCommands(_uid: string): Command[] {
    return notImplemented('BattleEngine.availableCommands');
  }

  /** 提交一条指令，返回本步产生的有序事件。 */
  submit(_cmd: Command): BattleEvent[] {
    return notImplemented('BattleEngine.submit');
  }

  get state(): Readonly<BattleState> {
    return notImplemented('BattleEngine.state');
  }
}
