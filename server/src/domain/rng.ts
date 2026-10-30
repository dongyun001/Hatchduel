/**
 * 服务端随机源（繁殖等一次性事件用）。
 *
 * 为什么不是 core 的 `mulberry32`：`@petbattle/core` 的公共入口只 re-export 类型与领域函数，
 * 没有导出 PRNG 构造器（`mulberry32` 在内部 `rng.ts`），服务端不能跨包深引用。
 * 繁殖结果由服务器生成并落库、不重放，所以这里用 CSPRNG（均匀分布）作为熵源；
 * 已按 CONTRACT §9.3 提请求让 A 导出 `createRng(seed)`，之后替换实现即可（`Rng` 接口不变）。
 */
import { randomInt } from 'node:crypto';

import type { Rng } from '@petbattle/core';

const UINT32 = 0x1_0000_0000;

export function createSecureRng(): Rng {
  const next = (() => randomInt(0, UINT32) / UINT32) as Rng;

  next.chance = (probability: number): boolean => next() < probability;

  next.pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('Rng.pick 不能用于空数组');
    const index = Math.floor(next() * items.length);
    return items[index] as T;
  };

  return next;
}
