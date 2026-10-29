import { describe, expect, it } from 'vitest';

import { MAX_LEVEL, applyExp, expToNext } from '@petbattle/core';

import { makePet, makeRepo } from './factory.js';

const cfg = makeRepo();

describe('expToNext（冻结公式）', () => {
  it('expToNext(level) = 40 + level × 20', () => {
    expect(expToNext(0)).toBe(40);
    expect(expToNext(1)).toBe(60);
    expect(expToNext(10)).toBe(240);
    expect(expToNext(20)).toBe(440);
  });
});

describe('applyExp（contract-v1.2 D-07）', () => {
  it('0 经验不改动（返回新对象，值不变）', () => {
    const pet = makePet({ level: 3, });
    const withExp = { ...pet, exp: 10 };
    const result = applyExp(withExp, 0, cfg);

    expect(result).not.toBe(withExp);
    expect(result.level).toBe(3);
    expect(result.exp).toBe(10);
  });

  it('负数 / 非有限值按 0 处理', () => {
    const pet = makePet({ level: 3 });
    expect(applyExp(pet, -100, cfg).exp).toBe(0);
    expect(applyExp(pet, Number.NaN, cfg).level).toBe(3);
    expect(applyExp(pet, Number.POSITIVE_INFINITY, cfg).exp).toBe(0);
  });

  it('刚好达到阈值：1 级 → 2 级，经验清零', () => {
    const pet = makePet({ level: 1 });
    expect(expToNext(1)).toBe(60);
    const result = applyExp(pet, 60, cfg);
    expect(result.level).toBe(2);
    expect(result.exp).toBe(0);
  });

  it('不足阈值只累加经验', () => {
    const result = applyExp(makePet({ level: 1 }), 59, cfg);
    expect(result.level).toBe(1);
    expect(result.exp).toBe(59);
  });

  it('一次跨多级：60 + 80 + 100 + 120 = 360 后到 5 级余 40', () => {
    const result = applyExp(makePet({ level: 1 }), 400, cfg);
    expect(result.level).toBe(5);
    expect(result.exp).toBe(40);
  });

  it('满级（20）不再升级，多余经验保留', () => {
    const pet = makePet({ level: MAX_LEVEL });
    const result = applyExp(pet, 1000, cfg);
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.exp).toBe(1000);

    const nearCap = applyExp(makePet({ level: MAX_LEVEL - 1 }), 500, cfg);
    expect(nearCap.level).toBe(MAX_LEVEL);
    expect(nearCap.exp).toBe(500 - expToNext(MAX_LEVEL - 1));
  });

  it('不修改入参', () => {
    const pet = { ...makePet({ level: 1 }), exp: 5 };
    const before = JSON.stringify(pet);
    applyExp(pet, 500, cfg);
    expect(JSON.stringify(pet)).toBe(before);
  });

  it('配置仓库不参与曲线计算（签名保留位）', () => {
    const pet = makePet({ level: 1 });
    const custom = makeRepo((config) => {
      (config['breeding'] as Record<string, unknown>)['hatchMs'] = 1;
    });
    expect(applyExp(pet, 60, custom)).toEqual(applyExp(pet, 60, cfg));
  });
});
