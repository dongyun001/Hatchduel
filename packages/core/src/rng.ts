/**
 * 确定性随机源（DOMAIN_MODEL §1.1）。
 *
 * 只实现 `mulberry32`：同一 seed 必须得到同一序列；core 不使用任何系统随机源。
 * `pick` 空数组抛错，不做隐式回退（DOMAIN §1.1）。
 *
 * 正态近似用 Irwin–Hall：`Σ(12 次 rng()) − 6`，均值 0、方差 1，只用加法（PITFALLS P-024）。
 */
import type { Rng } from './types/common.js';

const UINT32 = 4294967296;

/** 32 位混洗的 mulberry32；种子按 `>>> 0` 归一。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;

  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }) as Rng;

  next.chance = (p: number): boolean => next() < p;

  next.pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('@petbattle/core: rng.pick 不能用于空数组（DOMAIN_MODEL §1.1）');
    }
    const index = Math.floor(next() * items.length);
    return items[index] as T;
  };

  return next;
}

/**
 * 近似标准正态（Irwin–Hall，12 次均匀随机求和 − 6）。
 * 每次调用固定消费 12 次 `rng()`，保证确定性。
 */
export function gaussian(rng: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += rng();
  return sum - 6;
}
