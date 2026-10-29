// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 冻结的数值常量（AGENTS §3.2/§3.5，DOMAIN_MODEL §4/§5/§8/§9）。
 *
 * 改这些常量等同于改契约：必须升 contract 版本并通知 A/B/C/D。
 */
import type { Stage } from './types/pet';

/** 伤害公式分母常数：ATK × power × K / (K + DEF)。 */
export const DAMAGE_K = 400;

export const ENERGY_MAX = 100;
/** 战斗初始精力为 0（不是满值）。 */
export const ENERGY_INITIAL = 0;
export const ENERGY_PER_TURN = 20;
export const ENERGY_ON_NORMAL_HIT = 10;
export const SMALL_SKILL_ENERGY_MIN = 40;
export const SMALL_SKILL_ENERGY_MAX = 50;
export const ULTIMATE_ENERGY_MIN = 70;
export const ULTIMATE_ENERGY_MAX = 80;

export const MAX_TURNS = 30;

export const CRIT_DAMAGE_DEFAULT = 1.5;
export const HIT_BASE = 0.9;
export const HIT_CLAMP_MIN = 0.05;
export const HIT_CLAMP_MAX = 1;
export const DAMAGE_FLOAT_MIN = 0.95;
export const DAMAGE_FLOAT_SPAN = 0.1;

/** 攻方克制守方 / 攻方被守方克制 / 无关系。 */
export const COUNTER_STRONG = 1.25;
export const COUNTER_WEAK = 0.85;
export const COUNTER_NONE = 1;

/** 相性每级修正：契合 +10%、冲突 -10%。 */
export const AFFINITY_MULTIPLIER_STEP = 0.1;

/** 阶段系数；蛋不参与战斗与产出。 */
export const STAGE_MULTIPLIERS: Record<Stage, number> = {
  egg: 0,
  juvenile: 0.7,
  adult: 1,
  elder: 0.9,
};

/** 基因系数 = 0.85 + gene/100 × 0.30（0.85~1.15）。 */
export const GENE_MUL_BASE = 0.85;
export const GENE_MUL_SPAN = 0.3;

/** 状态系数 = 0.90 + 四维和/400 × 0.20（0.90~1.10）。 */
export const CONDITION_MUL_BASE = 0.9;
export const CONDITION_MUL_SPAN = 0.2;

export const MAX_LEVEL = 20;
/** expToNext(level) = EXP_BASE + level × EXP_PER_LEVEL；初版，待 sim。 */
export const EXP_BASE = 40;
export const EXP_PER_LEVEL = 20;
/** 首通经验 = STAGE_EXP_BASE + order × STAGE_EXP_PER_ORDER；重复为其 1/3。 */
export const STAGE_EXP_BASE = 30;
export const STAGE_EXP_PER_ORDER = 10;
export const REPEAT_EXP_DIVISOR = 3;

/** 近亲判定：共同祖先在 3 代以内。 */
export const INBREEDING_GENERATIONS = 3;

/** 离线产出上限 8 小时；状态衰减上限 24 小时；两者分开配置。 */
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
export const DECAY_CAP_MS = 24 * 60 * 60 * 1000;

/** 健康地板 1，不死亡。 */
export const HEALTH_FLOOR = 1;

/** 出战编队最多 3 只。 */
export const MAX_LINEUP_SIZE = 3;

/** 初始 3 只：水龟、雷鱼、草蛙（PRD §5.5）。 */
export const INITIAL_SPECIES_IDS = ['turtle', 'fish', 'frog'] as const;

/** MVP 物种（后续物种不进 MVP 关卡）。 */
export const MVP_SPECIES_IDS = ['turtle', 'fish', 'frog', 'cat', 'snake'] as const;

export const MVP_ELEMENT_IDS = ['water', 'fire', 'grass', 'earth', 'thunder'] as const;
