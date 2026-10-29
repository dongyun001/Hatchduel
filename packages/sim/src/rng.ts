/**
 * 模拟器用的确定性随机源。
 *
 * `Rng` 由调用方构造并注入 core（AGENTS §3.2）：core 只消费，不自己造随机源。
 * PRNG 固定 mulberry32；`pick` 空数组抛错（与 `Rng` 契约一致）。
 */
import type { Probability, Rng } from '@petbattle/core';

/** mulberry32：32 位状态、无浮点超越函数，跨平台一致。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng = ((): number => next()) as Rng;

  rng.chance = (p: Probability): boolean => rng() < p;
  rng.pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('rng.pick: items 不能为空');
    const index = Math.floor(rng() * items.length);
    const value = items[index];
    if (value === undefined) throw new Error('rng.pick: 索引越界');
    return value;
  };

  return rng;
}
