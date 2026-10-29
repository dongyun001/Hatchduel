import { describe, expect, it } from 'vitest';

import { MAX_LEVEL, createPet } from '@petbattle/core';

import { T0, makeGenome, makeRepo } from './factory.js';

const cfg = makeRepo();

function input(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pet_1',
    speciesId: 'fish',
    elementId: 'water' as const,
    genome: makeGenome(),
    gender: 'male' as const,
    generation: 1,
    now: T0,
    ...overrides,
  };
}

describe('createPet：基础行为（DOMAIN §3/§5.1/§8.2）', () => {
  it('新个体从蛋开始，时间戳与繁殖力按配置计算', () => {
    const pet = createPet(input(), cfg);
    const breeding = cfg.breeding();

    expect(pet.id).toBe('pet_1');
    expect(pet.speciesId).toBe('fish');
    expect(pet.elementId).toBe('water');
    expect(pet.stage).toBe('egg');
    expect(pet.bornAt).toBe(T0);
    expect(pet.stageChangedAt).toBe(T0);
    expect(pet.createdAt).toBe(T0);
    expect(pet.updatedAt).toBe(T0);
    expect(pet.fertility).toEqual({
      readyAt: T0 + breeding.hatchMs + breeding.juvenileMs,
      cooldownUntil: 0,
      penalty: 0,
    });
    expect(pet.condition).toEqual({ hunger: 100, mood: 100, hygiene: 100, health: 100 });
    expect(pet.level).toBe(1);
    expect(pet.exp).toBe(0);
    expect(pet.habitatId).toBeNull();
    expect(pet.locked).toBe(false);
    expect(pet.parents).toEqual([null, null]);
    expect(pet.ancestors).toEqual([]);
    expect(pet.traits).toEqual([]);
    expect(pet.hiddenTraits).toEqual([]);
  });

  it('level 与 parents/ancestors 按入参落库', () => {
    const pet = createPet(
      input({
        level: 7,
        parents: ['dad', 'mom'],
        ancestors: [{ id: 'dad', depth: 1 }, { id: 'gp', depth: 2 }],
        traits: ['trait_sturdy'],
        hiddenTraits: ['trait_swift'],
      }),
      cfg,
    );
    expect(pet.level).toBe(7);
    expect(pet.parents).toEqual(['dad', 'mom']);
    expect(pet.ancestors).toEqual([
      { id: 'dad', depth: 1 },
      { id: 'gp', depth: 2 },
    ]);
    expect(pet.traits).toEqual(['trait_sturdy']);
    expect(pet.hiddenTraits).toEqual(['trait_swift']);
  });

  it('未知物种/属性抛明确错误', () => {
    expect(() => createPet(input({ speciesId: 'dragon' }), cfg)).toThrow(/species.*dragon/);
    expect(() => createPet(input({ elementId: 'light' }), cfg)).toThrow(/elements.*light/);
  });

  it('level 必须是 1~20 的整数', () => {
    expect(createPet(input({ level: 1 }), cfg).level).toBe(1);
    expect(createPet(input({ level: MAX_LEVEL }), cfg).level).toBe(MAX_LEVEL);
    expect(() => createPet(input({ level: 0 }), cfg)).toThrow(/level/);
    expect(() => createPet(input({ level: MAX_LEVEL + 1 }), cfg)).toThrow(/level/);
    expect(() => createPet(input({ level: 1.5 }), cfg)).toThrow(/level/);
  });

  it('基因四舍五入并 clamp 0~100', () => {
    const pet = createPet(
      input({ genome: { ...makeGenome(), stats: { hp: 62.6, atk: -5, def: 120, spd: 60 } } }),
      cfg,
    );
    expect(pet.genome.stats).toEqual({ hp: 63, atk: 0, def: 100, spd: 60 });
    expect(() =>
      createPet(input({ genome: { ...makeGenome(), stats: { hp: Number.NaN, atk: 1, def: 1, spd: 1 } } }), cfg),
    ).toThrow(/基因/);
  });

  it('traits / hiddenTraits 去重', () => {
    const pet = createPet(
      input({
        traits: ['trait_sturdy', 'trait_sturdy', 'trait_lucky'],
        hiddenTraits: ['trait_swift', 'trait_swift'],
      }),
      cfg,
    );
    expect(pet.traits).toEqual(['trait_sturdy', 'trait_lucky']);
    expect(pet.hiddenTraits).toEqual(['trait_swift']);
  });

  it('不修改入参、也不与入参共享数组引用', () => {
    const genome = makeGenome();
    const traits = ['trait_sturdy'];
    const before = JSON.stringify({ genome, traits });
    const pet = createPet(input({ genome, traits }), cfg);

    expect(JSON.stringify({ genome, traits })).toBe(before);
    expect(pet.genome.stats).not.toBe(genome.stats);
    expect(pet.traits).not.toBe(traits);

    traits.push('trait_lucky');
    expect(pet.traits).toEqual(['trait_sturdy']);
  });
});
