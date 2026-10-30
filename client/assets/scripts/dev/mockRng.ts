import type { Rng } from '../../lib/core';

/**
 * 客户端本地随机源（仅离线演示用）。核心公式仍由 core 的 `breed` 消费注入的 Rng；
 * core 不导出 mulberry32（契约未公开），所以这里用本机随机数满足 `Rng` 形状。
 */
export function createMockRng(): Rng {
  const next = (() => Math.random()) as Rng;
  next.chance = (p: number): boolean => next() < p;
  next.pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('rng.pick 不能用于空数组');
    const item = items[Math.floor(next() * items.length)];
    if (item === undefined) throw new Error('rng.pick 下标越界');
    return item;
  };
  return next;
}
