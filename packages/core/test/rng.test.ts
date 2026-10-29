import { describe, expect, it } from 'vitest';

import { gaussian, mulberry32 } from '../src/rng.js';
import type { Rng } from '@petbattle/core';

describe('mulberry32（DOMAIN §1.1）', () => {
  it('同种子序列固定，不同种子不同', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = [a(), a(), a(), a(), a()];
    const second = [b(), b(), b(), b(), b()];
    expect(second).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);

    const other = mulberry32(54321);
    expect([other(), other(), other(), other(), other()]).not.toEqual(first);
  });

  it('输出始终在 [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('chance(0) 恒 false，chance(1) 恒 true', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('pick 空数组抛错（不做隐式回退）', () => {
    const rng = mulberry32(1);
    expect(() => rng.pick([])).toThrow(/空数组/);
  });

  it('pick 均匀选择且确定', () => {
    const items = ['a', 'b', 'c'] as const;
    const first = Array.from({ length: 300 }, (_, i) => mulberry32(i).pick(items));
    const second = Array.from({ length: 300 }, (_, i) => mulberry32(i).pick(items));
    expect(second).toEqual(first);
    for (const item of items) expect(first).toContain(item);
  });
});

describe('gaussian（Irwin–Hall，P-024）', () => {
  it('固定消费 12 次 rng，结果为 sum − 6', () => {
    let calls = 0;
    const fake = (() => {
      calls += 1;
      return 0.5;
    }) as Rng;
    fake.chance = () => true;
    fake.pick = <T>(items: readonly T[]): T => items[0] as T;

    expect(gaussian(fake)).toBe(0);
    expect(calls).toBe(12);
  });

  it('均值接近 0、方差接近 1（2000 次采样）', () => {
    const rng = mulberry32(999);
    const samples = Array.from({ length: 2000 }, () => gaussian(rng));
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance =
      samples.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
    expect(variance).toBeGreaterThan(0.85);
    expect(variance).toBeLessThan(1.15);
  });

  it('不使用超越函数即可跨种子复现', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const a = Array.from({ length: 20 }, () => gaussian(rngA));
    const b = Array.from({ length: 20 }, () => gaussian(rngB));
    expect(b).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(1);
  });
});
