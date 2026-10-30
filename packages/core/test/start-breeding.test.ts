import { describe, expect, it } from 'vitest';

import {
  BreedingError,
  TimeError,
  startBreeding,
  type BreedingErrorReason,
  type PetInstance,
} from '@petbattle/core';

import { mulberry32 } from '../src/rng.js';
import { HOUR, T0, makePet, makeProfile } from './factory.js';
import { makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();
const BREED_COST = { coin: 100, food: 20 } as const;

function parents(overrides: { a?: Parameters<typeof makePet>[0]; b?: Parameters<typeof makePet>[0] } = {}) {
  const a = makePet({ id: 'a', gender: 'male', updatedAt: T0, ...overrides.a });
  const b = makePet({ id: 'b', gender: 'female', updatedAt: T0, ...overrides.b });
  return { a, b };
}

function profileWith(a: PetInstance, b: PetInstance, extra: PetInstance[] = []) {
  return makeProfile([a, b, ...extra], []);
}

function reasonOf(run: () => unknown): BreedingErrorReason {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BreedingError);
    return (error as BreedingError).reason;
  }
  throw new Error('expected BreedingError');
}

describe('startBreeding：成功路径（D-17）', () => {
  it('扣费、落蛋、父母冷却、stats.breeds、patch 正确', () => {
    const { a, b } = parents();
    const profile = profileWith(a, b);
    const result = startBreeding(profile, 'a', 'b', T0, cfg, mulberry32(7));

    expect(result.child.stage).toBe('egg');
    expect(result.profile.pets[result.child.id]).toEqual(result.child);
    expect(result.profile.breeding.eggs).toEqual([result.child.id]);

    const nextA = result.profile.pets['a']!;
    const nextB = result.profile.pets['b']!;
    expect(nextA.fertility.cooldownUntil).toBe(result.parentCooldowns[0]);
    expect(nextB.fertility.cooldownUntil).toBe(result.parentCooldowns[1]);
    expect(result.profile.breeding.cooldowns['a']).toBe(result.parentCooldowns[0]);
    expect(result.profile.breeding.cooldowns['b']).toBe(result.parentCooldowns[1]);
    // 普通不近亲：2 小时
    expect(result.parentCooldowns).toEqual([T0 + 2 * HOUR, T0 + 2 * HOUR]);

    expect(result.profile.currencies.coin).toBe(1000 - BREED_COST.coin);
    expect(result.profile.currencies.food).toBe(100 - BREED_COST.food);
    expect(result.profile.stats.breeds).toBe(1);

    expect(result.patch.fromRevision).toBe(profile.revision);
    expect(result.patch.toRevision).toBe(profile.revision);
    expect(result.patch.currencies?.coin).toBe(900);
    expect(result.patch.pets?.upsert?.map((pet) => pet.id).sort()).toEqual(
      ['a', 'b', result.child.id].sort(),
    );
    expect(result.patch.breeding?.eggs).toEqual([result.child.id]);
    expect(result.patch.stats?.breeds).toBe(1);
  });

  it('同一 rng 种子结果确定', () => {
    const { a, b } = parents();
    const profile = profileWith(a, b);
    const first = startBreeding(profile, 'a', 'b', T0, cfg, mulberry32(42));
    const second = startBreeding(profile, 'a', 'b', T0, cfg, mulberry32(42));
    expect(second.child).toEqual(first.child);
  });

  it('不修改入参 profile', () => {
    const { a, b } = parents();
    const profile = profileWith(a, b);
    const before = JSON.stringify(profile);
    startBreeding(profile, 'a', 'b', T0, cfg, mulberry32(1));
    expect(JSON.stringify(profile)).toBe(before);
  });
});

describe('startBreeding：拒绝原因', () => {
  it('父母不存在 → not_found', () => {
    const { a, b } = parents();
    expect(reasonOf(() => startBreeding(profileWith(a, b), 'a', 'ghost', T0, cfg, mulberry32(1)))).toBe(
      'not_found',
    );
    expect(reasonOf(() => startBreeding(profileWith(a, b), 'ghost', 'a', T0, cfg, mulberry32(1)))).toBe(
      'not_found',
    );
  });

  it('同一只 / 同性 / 未成年 / 锁定', () => {
    const solo = makePet({ id: 'a', gender: 'male' });
    expect(reasonOf(() => startBreeding(profileWith(solo, solo), 'a', 'a', T0, cfg, mulberry32(1)))).toBe(
      'same_pet',
    );

    const sameGender = parents({ b: { gender: 'male' } });
    expect(
      reasonOf(() =>
        startBreeding(profileWith(sameGender.a, sameGender.b), 'a', 'b', T0, cfg, mulberry32(1)),
      ),
    ).toBe('same_gender');

    const egg = parents({ a: { stage: 'egg' } });
    expect(
      reasonOf(() => startBreeding(profileWith(egg.a, egg.b), 'a', 'b', T0, cfg, mulberry32(1))),
    ).toBe('not_adult');

    const locked = parents({ b: { locked: true } });
    expect(
      reasonOf(() => startBreeding(profileWith(locked.a, locked.b), 'a', 'b', T0, cfg, mulberry32(1))),
    ).toBe('locked');
  });

  it('未到可繁殖时间 → infertile；冷却中 → cooldown', () => {
    const notReady = parents({ a: { fertility: { readyAt: T0 + 1 } } });
    expect(
      reasonOf(() =>
        startBreeding(profileWith(notReady.a, notReady.b), 'a', 'b', T0, cfg, mulberry32(1)),
      ),
    ).toBe('infertile');

    const cooling = parents({ b: { fertility: { cooldownUntil: T0 + 1 } } });
    expect(
      reasonOf(() =>
        startBreeding(profileWith(cooling.a, cooling.b), 'a', 'b', T0, cfg, mulberry32(1)),
      ),
    ).toBe('cooldown');
  });

  it('容量满 → no_capacity；资源不足 → cost', () => {
    const { a, b } = parents();
    const full = profileWith(a, b, [makePet({ id: 'c' }), makePet({ id: 'd' })]);
    expect(reasonOf(() => startBreeding(full, 'a', 'b', T0, cfg, mulberry32(1)))).toBe(
      'no_capacity',
    );

    const poor = profileWith(a, b);
    poor.currencies.food = 0;
    expect(reasonOf(() => startBreeding(poor, 'a', 'b', T0, cfg, mulberry32(1)))).toBe('cost');
  });

  it('时间倒退抛 TimeError', () => {
    const { a, b } = parents();
    expect(() => startBreeding(profileWith(a, b), 'a', 'b', T0 - 1, cfg, mulberry32(1))).toThrow(
      TimeError,
    );
  });
});

describe('startBreeding：近亲', () => {
  it('标记 inbred、子代惩罚、父母冷却 ×1.2', () => {
    const { a, b } = parents({
      a: { ancestors: [{ id: 'gp', depth: 2 }] },
      b: { ancestors: [{ id: 'gp', depth: 2 }] },
    });
    const result = startBreeding(profileWith(a, b), 'a', 'b', T0, cfg, mulberry32(9));

    expect(result.inbred).toBe(true);
    expect(result.child.fertility.penalty).toBe(0.2);
    expect(result.parentCooldowns).toEqual([
      T0 + Math.floor(2 * HOUR * 1.2),
      T0 + Math.floor(2 * HOUR * 1.2),
    ]);
  });
});
