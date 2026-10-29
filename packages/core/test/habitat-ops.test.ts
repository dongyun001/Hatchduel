import { describe, expect, it } from 'vitest';

import {
  TimeError,
  cleanPet,
  collectHabitat,
  feedPet,
  movePetToHabitat,
  playWithPet,
  upgradeHabitat,
  type HabitatInstance,
  type Profile,
} from '@petbattle/core';

import { T0, habitatRow, makePet, makeProfile, makeRepo } from './factory.js';
import { makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();
const HABITAT = 'meadow';

function expectHabitatError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('HabitatError');
    expect((error as Error & { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected HabitatError(${code})`);
}

function secondHabitat(profile: Profile): Profile {
  return {
    ...profile,
    habitats: {
      ...profile.habitats,
      meadow2: {
        ...(profile.habitats[HABITAT] as HabitatInstance),
        id: 'meadow2',
        slots: [null, null, null, null],
      },
    },
  };
}

describe('movePetToHabitat（D-12）', () => {
  it('放入空栖息地：填槽位、写 habitatId、patch 正确且 revision 保持输入值', () => {
    const pet = makePet({ id: 'p1' });
    const profile = makeProfile([pet], []);
    const result = movePetToHabitat(profile, 'p1', HABITAT, T0, cfg);

    expect(result.profile.pets['p1']!.habitatId).toBe(HABITAT);
    expect(result.profile.habitats[HABITAT]!.slots[0]).toBe('p1');
    expect(result.profile.habitats[HABITAT]!.slots).toHaveLength(4);
    expect(result.patch.pets?.upsert?.map((item) => item.id)).toEqual(['p1']);
    expect(result.patch.habitats?.upsert?.map((item) => item.id)).toEqual([HABITAT]);
    expect(result.patch.fromRevision).toBe(profile.revision);
    expect(result.patch.toRevision).toBe(profile.revision);
    expect(result.patch.lastEvaluatedAt).toBe(profile.lastEvaluatedAt);
  });

  it('移出栖息地（habitatId = null）', () => {
    const pet = makePet({ id: 'p1', habitatId: HABITAT });
    const profile = makeProfile([pet], ['p1']);
    const result = movePetToHabitat(profile, 'p1', null, T0, cfg);

    expect(result.profile.pets['p1']!.habitatId).toBeNull();
    expect(result.profile.habitats[HABITAT]!.slots[0]).toBeNull();
  });

  it('容量满 → capacity_full', () => {
    const pets = [1, 2, 3, 4, 5].map((i) => makePet({ id: `p${i}` }));
    const profile = makeProfile(pets, ['p1', 'p2', 'p3', 'p4']);
    expectHabitatError(() => movePetToHabitat(profile, 'p5', HABITAT, T0, cfg), 'capacity_full');
  });

  it('同一只宠物不会占两个槽位；重复放入同一栖息地是幂等的', () => {
    const pet = makePet({ id: 'p1' });
    const profile = secondHabitat(makeProfile([pet], []));

    const first = movePetToHabitat(profile, 'p1', HABITAT, T0, cfg);
    const second = movePetToHabitat(first.profile, 'p1', HABITAT, T0, cfg);
    expect(second.patch.pets).toBeUndefined();
    expect(second.patch.habitats).toBeUndefined();

    const moved = movePetToHabitat(first.profile, 'p1', 'meadow2', T0, cfg);
    expect(moved.profile.habitats[HABITAT]!.slots).not.toContain('p1');
    expect(moved.profile.habitats['meadow2']!.slots).toContain('p1');
    const allSlots = Object.values(moved.profile.habitats).flatMap((habitat) => habitat.slots);
    expect(allSlots.filter((slot) => slot === 'p1')).toHaveLength(1);
  });

  it('非本人宠物 / 蛋 / 未知栖息地 / 时间倒退都拒绝', () => {
    const egg = makePet({ id: 'egg', stage: 'egg' });
    const profile = makeProfile([egg], []);
    expectHabitatError(() => movePetToHabitat(profile, 'ghost', HABITAT, T0, cfg), 'pet_not_found');
    expectHabitatError(() => movePetToHabitat(profile, 'egg', HABITAT, T0, cfg), 'egg_not_allowed');
    expectHabitatError(
      () => movePetToHabitat(makeProfile([makePet({ id: 'p' })], []), 'p', 'nope', T0, cfg),
      'habitat_not_found',
    );
    expect(() =>
      movePetToHabitat(makeProfile([makePet({ id: 'p' })], []), 'p', HABITAT, T0 - 1, cfg),
    ).toThrow(TimeError);
  });
});

describe('feedPet（D-12）', () => {
  it('扣食物成本并按 FoodConfig 恢复 hunger / mood', () => {
    const pet = makePet({ id: 'p1', condition: { hunger: 50, mood: 50 } });
    const profile = makeProfile([pet], []);
    const result = feedPet(profile, 'p1', 'kibble', T0, cfg);

    expect(result.profile.pets['p1']!.condition.hunger).toBe(75);
    expect(result.profile.pets['p1']!.condition.mood).toBe(55);
    expect(result.profile.currencies.coin).toBe(990);
    expect(result.patch.currencies?.coin).toBe(990);
    expect(result.patch.pets?.upsert).toHaveLength(1);
  });

  it('恢复量 clamp 到 100', () => {
    const pet = makePet({ id: 'p1', condition: { hunger: 95, mood: 99 } });
    const result = feedPet(makeProfile([pet], []), 'p1', 'kibble', T0, cfg);
    expect(result.profile.pets['p1']!.condition.hunger).toBe(100);
    expect(result.profile.pets['p1']!.condition.mood).toBe(100);
  });

  it('资源不足 → insufficient_resources，且不改动存档', () => {
    const pet = makePet({ id: 'p1' });
    const profile = makeProfile([pet], []);
    profile.currencies.coin = 0;
    expectHabitatError(() => feedPet(profile, 'p1', 'kibble', T0, cfg), 'insufficient_resources');
    expect(profile.pets['p1']!.condition.hunger).toBe(100);
  });

  it('未知食物 / 蛋 → 拒绝', () => {
    expectHabitatError(
      () => feedPet(makeProfile([makePet({ id: 'p' })], []), 'p', 'nope', T0, cfg),
      'food_not_found',
    );
    expectHabitatError(
      () => feedPet(makeProfile([makePet({ id: 'e', stage: 'egg' })], []), 'e', 'kibble', T0, cfg),
      'egg_not_allowed',
    );
  });
});

describe('cleanPet / playWithPet（D-12）', () => {
  it('默认恢复 +20，并 clamp 100', () => {
    const pet = makePet({ id: 'p1', condition: { hygiene: 50, mood: 90 } });
    const profile = makeProfile([pet], []);
    const cleaned = cleanPet(profile, 'p1', T0, cfg);
    expect(cleaned.profile.pets['p1']!.condition.hygiene).toBe(70);

    const played = playWithPet(cleaned.profile, 'p1', T0, cfg);
    expect(played.profile.pets['p1']!.condition.mood).toBe(100);
    // 不消耗资源
    expect(played.profile.currencies).toEqual(profile.currencies);
  });

  it('读取 HabitatConfig.careRecoveryPerAction', () => {
    const custom = makeSyntheticRepo((config) => {
      habitatRow(config, 'meadow')['careRecoveryPerAction'] = { clean: 35, play: 5 };
    });
    const pet = makePet({ id: 'p1', habitatId: HABITAT, condition: { hygiene: 10, mood: 10 } });
    const profile = makeProfile([pet], ['p1']);

    expect(cleanPet(profile, 'p1', T0, custom).profile.pets['p1']!.condition.hygiene).toBe(45);
    expect(playWithPet(profile, 'p1', T0, custom).profile.pets['p1']!.condition.mood).toBe(15);
  });

  it('不在栖息地时使用默认值；蛋拒绝', () => {
    const custom = makeSyntheticRepo((config) => {
      habitatRow(config, 'meadow')['careRecoveryPerAction'] = { clean: 35, play: 5 };
    });
    const outside = makePet({ id: 'p1', habitatId: null, condition: { hygiene: 10 } });
    const cleaned = cleanPet(makeProfile([outside], []), 'p1', T0, custom);
    expect(cleaned.profile.pets['p1']!.condition.hygiene).toBe(30);

    expectHabitatError(
      () => cleanPet(makeProfile([makePet({ id: 'e', stage: 'egg' })], []), 'e', T0, cfg),
      'egg_not_allowed',
    );
  });
});

describe('upgradeHabitat（D-12）', () => {
  it('1 → 2 级：扣配置成本、扩容、slots 补齐', () => {
    const profile = makeProfile([], []);
    profile.currencies = { ...profile.currencies, coin: 1000, geneDust: 30 };
    const result = upgradeHabitat(profile, HABITAT, T0, cfg);
    const habitat = result.profile.habitats[HABITAT]!;

    expect(habitat.level).toBe(2);
    expect(habitat.slots).toHaveLength(5);
    // 合成配置：level 2 成本 = 500 coin + 20 geneDust
    expect(result.profile.currencies.coin).toBe(500);
    expect(result.profile.currencies.geneDust).toBe(10);
    expect(result.patch.habitats?.upsert?.map((item) => item.id)).toEqual([HABITAT]);
    expect(result.patch.currencies?.coin).toBe(500);
  });

  it('满级 → max_level，资源不足 → insufficient_resources', () => {
    const profile = makeProfile([], []);
    profile.habitats[HABITAT] = { ...(profile.habitats[HABITAT] as HabitatInstance), level: 3 };
    expectHabitatError(() => upgradeHabitat(profile, HABITAT, T0, cfg), 'max_level');

    const poor = makeProfile([], []);
    poor.currencies.coin = 0;
    expectHabitatError(() => upgradeHabitat(poor, HABITAT, T0, cfg), 'insufficient_resources');
  });
});

describe('collectHabitat（D-12）', () => {
  it('stored 转入 currencies，货币取整、零头留在 stored', () => {
    const profile = makeProfile([], []);
    profile.habitats[HABITAT] = {
      ...(profile.habitats[HABITAT] as HabitatInstance),
      stored: { coin: 10, food: 2.5 },
    };

    const result = collectHabitat(profile, HABITAT, T0, cfg);
    expect(result.profile.currencies.coin).toBe(1010);
    expect(result.profile.currencies.food).toBe(102);
    expect(result.profile.habitats[HABITAT]!.stored).toEqual({ coin: 0, food: 0.5 });
    expect(result.patch.currencies).toBeDefined();
    expect(result.patch.habitats?.upsert).toHaveLength(1);
  });

  it('没有可领取资源时不产生 patch 变更', () => {
    const profile = makeProfile([], []);
    const result = collectHabitat(profile, HABITAT, T0, cfg);
    expect(result.patch.currencies).toBeUndefined();
    expect(result.patch.habitats).toBeUndefined();
  });

  it('未知栖息地 / 时间倒退都拒绝', () => {
    expectHabitatError(() => collectHabitat(makeProfile([], []), 'nope', T0, cfg), 'habitat_not_found');
    expect(() => collectHabitat(makeProfile([], []), HABITAT, T0 - 1, cfg)).toThrow(TimeError);
  });
});

describe('栖息地操作：不改入参、patch 不含多余的章节', () => {
  it('操作前后输入 profile 不变', () => {
    const pet = makePet({ id: 'p1', condition: { hunger: 50 } });
    const profile = makeProfile([pet], []);
    const before = JSON.stringify(profile);
    feedPet(profile, 'p1', 'kibble', T0, cfg);
    movePetToHabitat(profile, 'p1', HABITAT, T0, cfg);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('实际数据（makeRepo）也能跑通核心路径', () => {
    const pet = makePet({ id: 'p1', habitatId: 'meadow' });
    const profile = makeProfile([pet], ['p1']);
    const result = movePetToHabitat(profile, 'p1', null, T0, makeRepo());
    expect(result.profile.pets['p1']!.habitatId).toBeNull();
    expect(result.profile.habitats['meadow']!.slots[0]).toBeNull();
  });
});
