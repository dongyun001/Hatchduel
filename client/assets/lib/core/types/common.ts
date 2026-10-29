// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 领域基础类型（DOMAIN_MODEL §1）。
 *
 * 约定：
 * - 时间 `EpochMs` 由调用方传入，core 内禁止读时钟。
 * - 随机 `Rng` 由调用方注入，core 内禁止 Math.random。
 */

/** 全局唯一 ID。宠物 / 栖息地 / 账号各自唯一。 */
export type Id = string;

/** UTC 毫秒时间戳。 */
export type EpochMs = number;

/** 概率，0~1。 */
export type Probability = number;

/** 属性 id（MVP 5 种）。 */
export type ElementId = 'water' | 'fire' | 'grass' | 'earth' | 'thunder';

/** 资源 id（DOMAIN_MODEL §10）；`premium` 在 Demo 阶段不启用。 */
export type ResourceId = 'coin' | 'food' | 'geneDust' | 'premium';

/**
 * 确定性随机源。由调用方构造（PRNG 固定为 mulberry32），core 只消费。
 * 同一场战斗 / 繁殖只使用一个实例，按固定顺序消费；`pick` 空数组必须抛错。
 */
export interface Rng {
  (): number;
  chance(p: Probability): boolean;
  pick<T>(items: readonly T[]): T;
}

/** 属性 × 物种相性：1 契合、0 普通、-1 冲突。 */
export type Affinity = 1 | 0 | -1;

/** 物种单向克制倍率：攻方克制 1.25 / 被克制 0.85 / 无关系 1。 */
export type CounterMultiplier = 1.25 | 0.85 | 1;
