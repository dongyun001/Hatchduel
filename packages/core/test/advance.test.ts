import { describe, expect, it } from 'vitest';

import {
  TimeError,
  advanceHabitat,
  advancePet,
  advanceProfile,
  type HabitatInstance,
} from '@petbattle/core';

import { HOUR, MINUTE, T0, habitatRow, makePet, makeProfile, makeRepo } from './factory.js';

function habitatAt(overrides: Partial<HabitatInstance> = {}): HabitatInstance {
  return {
    id: 'meadow',
    configId: 'meadow',
    level: 1,
    slots: [],
    lastEvaluatedAt: T0,
    stored: {},
    ...overrides,
  };
}

describe('advancePet：阶段推进（DOMAIN §5.1）', () => {
  const cfg = makeRepo();
  const breeding = cfg.breeding();

  it('蛋 → 幼年 → 成年 → 老年，stageChangedAt 落在阈值时刻', () => {
    const egg = makePet({ id: 'egg_1', stage: 'egg', bornAt: T0, stageChangedAt: T0, updatedAt: T0 });

    const hatched = advancePet(egg, T0 + breeding.hatchMs, cfg);
    expect(hatched.pet.stage).toBe('juvenile');
    expect(hatched.pet.stageChangedAt).toBe(T0 + breeding.hatchMs);
    expect(hatched.changed).toBe(true);

    const adult = advancePet(hatched.pet, T0 + breeding.hatchMs + breeding.juvenileMs, cfg);
    expect(adult.pet.stage).toBe('adult');
    expect(adult.pet.stageChangedAt).toBe(T0 + breeding.hatchMs + breeding.juvenileMs);

    const elder = advancePet(adult.pet, adult.pet.stageChangedAt + breeding.elderAfterMs, cfg);
    expect(elder.pet.stage).toBe('elder');
    expect(elder.pet.stageChangedAt).toBe(adult.pet.stageChangedAt + breeding.elderAfterMs);
  });

  it('一次跨多个阶段：长时间离线直接推到老年', () => {
    const egg = makePet({ stage: 'egg', bornAt: T0, stageChangedAt: T0, updatedAt: T0 });
    const far = T0 + breeding.hatchMs + breeding.juvenileMs + breeding.elderAfterMs + HOUR;
    const result = advancePet(egg, far, cfg);
    expect(result.pet.stage).toBe('elder');
  });

  it('未到阈值不推进', () => {
    const egg = makePet({ stage: 'egg', bornAt: T0, stageChangedAt: T0, updatedAt: T0 });
    const result = advancePet(egg, T0 + breeding.hatchMs - 1, cfg);
    expect(result.pet.stage).toBe('egg');
    expect(result.pet.stageChangedAt).toBe(T0);
  });

  it('同一 now 幂等：第二次 changed=false 且深相等', () => {
    const pet = makePet();
    const first = advancePet(pet, T0 + HOUR, cfg);
    const second = advancePet(first.pet, T0 + HOUR, cfg);
    expect(second.changed).toBe(false);
    expect(second.pet).toEqual(first.pet);
  });

  it('now 倒退抛 TimeError', () => {
    const pet = makePet({ updatedAt: T0 });
    expect(() => advancePet(pet, T0 - 1, cfg)).toThrow(TimeError);
  });

  it('不修改入参对象', () => {
    const pet = makePet({ stage: 'egg', bornAt: T0, stageChangedAt: T0, updatedAt: T0 });
    const before = JSON.stringify(pet);
    advancePet(pet, T0 + breeding.hatchMs, cfg);
    expect(JSON.stringify(pet)).toBe(before);
  });
});

describe('advanceHabitat：产出与消耗（DOMAIN §6.1/§6.2）', () => {
  const cfg = makeRepo();

  it('1 只成年水鱼 1 小时：产出 13 金币 / 6 食物 / 1 基因尘，食物扣 1 维护', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const result = advanceHabitat(habitatAt({ slots: [pet.id] }), [pet], T0 + HOUR, cfg);

    expect(result.produced).toEqual({ coin: 13, food: 6, geneDust: 1 });
    expect(result.habitat.stored).toEqual({ coin: 13, food: 5, geneDust: 1 });
    expect(result.habitat.lastEvaluatedAt).toBe(T0 + HOUR);
  });

  it('宠物数为 0 时产出为 0，不除以 0', () => {
    const result = advanceHabitat(habitatAt(), [], T0 + HOUR, cfg);
    expect(result.produced).toEqual({});
    expect(result.habitat.stored).toEqual({});
  });

  it('蛋不产出也不消耗', () => {
    const egg = makePet({ stage: 'egg', habitatId: 'meadow' });
    const result = advanceHabitat(habitatAt({ slots: [egg.id] }), [egg], T0 + HOUR, cfg);
    expect(result.produced).toEqual({});
    expect(result.habitat.stored).toEqual({});
  });

  it('离线产出封顶 8 小时（P-025）', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const eightHours = advanceHabitat(habitatAt({ slots: [pet.id] }), [pet], T0 + 8 * HOUR, cfg);
    const hundredHours = advanceHabitat(
      habitatAt({ slots: [pet.id] }),
      [pet],
      T0 + 100 * HOUR,
      cfg,
    );
    expect(hundredHours.produced).toEqual(eightHours.produced);
    expect(hundredHours.produced.coin).toBe(110);
  });

  it('不足 10 分钟的零头按 dtHours 线性插值，不整小时截断', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const result = advanceHabitat(
      habitatAt({ slots: [pet.id] }),
      [pet],
      T0 + 10 * MINUTE,
      cfg,
    );
    expect(result.produced.coin).toBe(2);
    expect(result.produced.food).toBe(1);
    expect(result.produced.geneDust).toBeUndefined();
  });

  it('阶段产出系数：幼年 0.5 / 成年 1 / 老年 0.8', () => {
    const juvenile = makePet({ id: 'j', stage: 'juvenile', habitatId: 'meadow' });
    const elder = makePet({ id: 'e', stage: 'elder', habitatId: 'meadow' });
    expect(
      advanceHabitat(habitatAt({ slots: ['j'] }), [juvenile], T0 + HOUR, cfg).produced.coin,
    ).toBe(6);
    expect(
      advanceHabitat(habitatAt({ slots: ['e'] }), [elder], T0 + HOUR, cfg).produced.coin,
    ).toBe(11);
  });

  it('元素加成按宠物数量叠加；心情乘数参与产出', () => {
    const a = makePet({ id: 'a', habitatId: 'meadow' });
    const b = makePet({ id: 'b', habitatId: 'meadow' });
    const two = advanceHabitat(habitatAt({ slots: ['a', 'b'] }), [a, b], T0 + HOUR, cfg);
    expect(two.produced.coin).toBe(15);

    const sad = makePet({ id: 's', habitatId: 'meadow', condition: { mood: 50 } });
    const sadResult = advanceHabitat(habitatAt({ slots: ['s'] }), [sad], T0 + HOUR, cfg);
    expect(sadResult.produced.coin).toBe(12);
  });

  it('栖息地等级产出乘数取自配置', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const upgraded = advanceHabitat(
      habitatAt({ slots: [pet.id], level: 2 }),
      [pet],
      T0 + HOUR,
      cfg,
    );
    expect(upgraded.produced.coin).toBe(15);
  });

  it('now 倒退抛 TimeError', () => {
    expect(() => advanceHabitat(habitatAt(), [], T0 - 1, cfg)).toThrow(TimeError);
  });
});

describe('advanceProfile：顺序 / 衰减 / 幂等（DOMAIN §5.2/§7）', () => {
  const highProduction = makeRepo((config) => {
    (habitatRow(config, 'meadow')['productionPerHour'] as Array<Record<string, unknown>>)[0]![
      'amountPerHour'
    ] = 1000;
  });

  it('先衰减后产出：产出使用推进后的心情', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const profile = makeProfile([pet], [pet.id]);
    const result = advanceProfile(profile, T0 + HOUR, highProduction);
    // 心情 100 → 98：0.8 + 0.98 × 0.2 = 0.996；1000 × 1.15 × 0.996 = 1145.4
    expect(result.profile.habitats.meadow!.stored.coin).toBe(1145);
  });

  it('1 小时后饥饿 -3 / 心情 -2 / 清洁 -2，健康回满', () => {
    const pet = makePet({ habitatId: 'meadow', condition: { health: 90 } });
    const result = advanceProfile(makeProfile([pet], [pet.id]), T0 + HOUR, makeRepo());
    const updated = result.profile.pets[pet.id]!;
    expect(updated.condition.hunger).toBe(97);
    expect(updated.condition.mood).toBe(98);
    expect(updated.condition.hygiene).toBe(98);
    expect(updated.condition.health).toBe(94);
  });

  it('状态衰减封顶 24 小时（P-025）', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const result = advanceProfile(makeProfile([pet], [pet.id]), T0 + 100 * HOUR, makeRepo());
    const updated = result.profile.pets[pet.id]!;
    expect(updated.condition.hunger).toBe(28);
    expect(updated.condition.mood).toBe(52);
    expect(updated.condition.hygiene).toBe(52);
  });

  it('饥饿见底时扣健康，健康地板 1', () => {
    const starving = makePet({ id: 's', habitatId: 'meadow', condition: { hunger: 2 } });
    const first = advanceProfile(makeProfile([starving], ['s']), T0 + HOUR, makeRepo());
    expect(first.profile.pets['s']!.condition.hunger).toBe(0);
    expect(first.profile.pets['s']!.condition.health).toBe(98);

    const dying = makePet({
      id: 'd',
      habitatId: 'meadow',
      condition: { hunger: 0, hygiene: 0, health: 2 },
    });
    const second = advanceProfile(makeProfile([dying], ['d']), T0 + HOUR, makeRepo());
    expect(second.profile.pets['d']!.condition.health).toBe(1);
  });

  it('不在栖息地的宠物不衰减', () => {
    const pet = makePet({ habitatId: null });
    const result = advanceProfile(makeProfile([pet], []), T0 + HOUR, makeRepo());
    expect(result.profile.pets[pet.id]!.condition.hunger).toBe(100);
  });

  it('同一 now 幂等：第二次无变化、revision 不变', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const profile = makeProfile([pet], [pet.id]);
    const first = advanceProfile(profile, T0 + HOUR, makeRepo());
    const second = advanceProfile(first.profile, T0 + HOUR, makeRepo());

    expect(second.profile.revision).toBe(first.profile.revision);
    expect(JSON.stringify(second.profile)).toBe(JSON.stringify(first.profile));
    expect(second.patch.pets).toBeUndefined();
    expect(second.patch.habitats).toBeUndefined();
    expect(first.patch.pets?.upsert).toHaveLength(1);
    expect(first.patch.habitats?.upsert).toHaveLength(1);
    expect(first.patch.fromRevision).toBe(1);
    expect(first.patch.toRevision).toBe(2);
  });

  it('now 倒退抛 TimeError', () => {
    const profile = makeProfile([], []);
    expect(() => advanceProfile(profile, T0 - 1, makeRepo())).toThrow(TimeError);
  });

  it('不改写入参 profile', () => {
    const pet = makePet({ habitatId: 'meadow' });
    const profile = makeProfile([pet], [pet.id]);
    const before = JSON.stringify(profile);
    advanceProfile(profile, T0 + HOUR, makeRepo());
    expect(JSON.stringify(profile)).toBe(before);
  });
});
