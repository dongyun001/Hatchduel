import { describe, expect, it } from 'vitest';

import { deriveStats } from '@petbattle/core';

import { addTrait, makePet, makeRepo, speciesRow } from './factory.js';

const ATK_TRAIT = {
  id: 'trait_test_atk',
  name: '测试攻击',
  rarity: 'common',
  description: '攻击 +5%。',
  statMods: { atk: 1.05 },
  inheritance: { weight: 0.5 },
};

describe('deriveStats：DOMAIN §4.2 示例', () => {
  it('ATK 20 → 35（等级 10 / 基因 62 / 状态 80 / 特质 ×1.05 / 相性冲突 ×0.9）', () => {
    const cfg = makeRepo((config) => addTrait(config, ATK_TRAIT));
    const pet = makePet({
      speciesId: 'fish',
      elementId: 'fire',
      level: 10,
      traits: ['trait_test_atk'],
      genome: {
        stats: { hp: 62, atk: 62, def: 62, spd: 62 },
        speciesAlleles: ['fish', 'fish'],
        elementAlleles: ['fire', 'fire'],
        traitAlleles: [],
        mutationCount: 0,
      },
      condition: { hunger: 80, mood: 80, hygiene: 80, health: 80 },
    });

    expect(deriveStats(pet, cfg).atk).toBe(35);
  });
});

describe('deriveStats：等级 / 基因 / 状态 / 阶段', () => {
  const cfg = makeRepo();

  it('等级 1、基因 60、满状态的水鱼基准值', () => {
    const stats = deriveStats(makePet({ speciesId: 'fish', elementId: 'water' }), cfg);
    expect(stats).toEqual({
      hp: 81,
      atk: 22,
      def: 10,
      spd: 14,
      crit: 0.055,
      critDmg: 1.65,
      hit: 0,
      dodge: 0.055,
    });
  });

  it('等级系数 1 + 0.08 × (level − 1)', () => {
    const level10 = deriveStats(makePet({ speciesId: 'fish', level: 10 }), cfg);
    expect(level10.atk).toBe(38);
    const level20 = deriveStats(makePet({ speciesId: 'fish', level: 20 }), cfg);
    expect(level20.atk).toBe(Math.floor(20 * (1 + 0.08 * 19) * 1.03 * 1.1));
  });

  it('基因系数 0.85~1.15', () => {
    const zero = deriveStats(makePet({ genome: { ...makePet().genome, stats: { hp: 0, atk: 0, def: 0, spd: 0 } } }), cfg);
    expect(zero.atk).toBe(18);
    const max = deriveStats(
      makePet({ genome: { ...makePet().genome, stats: { hp: 100, atk: 100, def: 100, spd: 100 } } }),
      cfg,
    );
    expect(max.atk).toBe(25);
  });

  it('状态系数 0.90~1.10', () => {
    const bad = deriveStats(
      makePet({ condition: { hunger: 0, mood: 0, hygiene: 0, health: 1 } }),
      cfg,
    );
    expect(bad.atk).toBe(18);
    const good = deriveStats(makePet(), cfg);
    expect(good.atk).toBe(22);
  });

  it('阶段系数：幼年 0.7 / 成年 1 / 老年 0.9', () => {
    expect(deriveStats(makePet({ stage: 'juvenile' }), cfg).atk).toBe(15);
    expect(deriveStats(makePet({ stage: 'adult' }), cfg).atk).toBe(22);
    expect(deriveStats(makePet({ stage: 'elder' }), cfg).atk).toBe(20);
  });

  it('蛋阶段全部为 0', () => {
    const stats = deriveStats(makePet({ stage: 'egg' }), cfg);
    expect(stats).toEqual({ hp: 0, atk: 0, def: 0, spd: 0, crit: 0, critDmg: 0, hit: 0, dodge: 0 });
  });
});

describe('deriveStats：特质 / 被动 / 相性', () => {
  it('特质与被动乘数都计入', () => {
    const cfg = makeRepo((config) => addTrait(config, ATK_TRAIT));
    const withTrait = deriveStats(makePet({ traits: ['trait_test_atk'] }), cfg);
    expect(withTrait.atk).toBe(23);

    // 鱼的被动是速度 +6%。
    const fish = deriveStats(makePet({ speciesId: 'fish' }), cfg);
    const noPassiveCfg = makeRepo((config) => {
      delete speciesRow(config, 'fish')['passiveId'];
    });
    expect(fish.spd).toBe(14);
    expect(deriveStats(makePet({ speciesId: 'fish' }), noPassiveCfg).spd).toBe(13);
  });

  it('相性只作用于 hp/atk/def/spd', () => {
    const cfg = makeRepo();
    const clash = deriveStats(makePet({ speciesId: 'fish', elementId: 'fire' }), cfg);
    const fit = deriveStats(makePet({ speciesId: 'turtle', elementId: 'water' }), cfg);
    const plain = deriveStats(makePet({ speciesId: 'fish', elementId: 'water' }), cfg);

    expect(clash.atk).toBeLessThan(plain.atk);
    expect(clash.crit).toBe(plain.crit);
    expect(clash.critDmg).toBe(plain.critDmg);
    expect(fit.atk).toBeGreaterThan(0);
  });

  it('相性冲突固定 -10%、契合 +10%（同一物种同一等级）', () => {
    const cfg = makeRepo();
    const plainTurtle = deriveStats(makePet({ speciesId: 'turtle', elementId: 'fire' }), cfg);
    const fitTurtle = deriveStats(makePet({ speciesId: 'turtle', elementId: 'water' }), cfg);

    // 基础期望：17 × 1.03 × 1.1 × (1 ± 0.1)
    expect(plainTurtle.atk).toBe(Math.floor(17 * 1.03 * 1.1));
    expect(fitTurtle.atk).toBe(Math.floor(17 * 1.03 * 1.1 * 1.1));
  });
});

describe('deriveStats：比例属性 clamp（DOMAIN §4.1）', () => {
  const cfg = makeRepo((config) => {
    addTrait(config, {
      id: 'trait_test_ratio',
      name: '测试比例',
      rarity: 'common',
      description: '暴击/闪避/命中大幅提升。',
      statMods: { crit: 30, dodge: 30 },
      inheritance: { weight: 0.5 },
    });
    addTrait(config, {
      id: 'trait_test_hit',
      name: '测试命中',
      rarity: 'common',
      description: '命中 ×3。',
      statMods: { hit: 3 },
      inheritance: { weight: 0.5 },
    });
  });

  it('crit clamp 到 1，dodge clamp 到 0.9', () => {
    const stats = deriveStats(makePet({ traits: ['trait_test_ratio'] }), cfg);
    expect(stats.crit).toBe(1);
    expect(stats.dodge).toBe(0.9);
  });

  it('hit 是加法增量（D-13）：+0.1 表示 +10 个百分点，再乘状态系数', () => {
    const additive = makeRepo((c) => {
      addTrait(c, {
        id: 't_hit_10',
        name: '命中 +10',
        rarity: 'common',
        description: '命中 +0.1。',
        statMods: { hit: 0.1 },
        inheritance: { weight: 0.5 },
      });
      addTrait(c, {
        id: 't_hit_15',
        name: '命中 +15',
        rarity: 'common',
        description: '命中 +0.15。',
        statMods: { hit: 0.15 },
        inheritance: { weight: 0.5 },
      });
    });

    // 基础 hit 0，满状态 condMul 1.1：(0 + 0.1) × 1.1
    expect(deriveStats(makePet({ traits: ['t_hit_10'] }), additive).hit).toBeCloseTo(0.11, 4);
    // 多条特质相加：(0 + 0.1 + 0.15) × 1.1
    expect(
      deriveStats(makePet({ traits: ['t_hit_10', 't_hit_15'] }), additive).hit,
    ).toBeCloseTo(0.275, 4);
  });

  it('hit 加法后可正可负，并 clamp 到 ±0.5', () => {
    const negativeBase = makeRepo((c) => {
      (speciesRow(c, 'fish')['base'] as Record<string, unknown>)['hit'] = -0.4;
      addTrait(c, {
        id: 't_hit_10',
        name: '命中 +10',
        rarity: 'common',
        description: '命中 +0.1。',
        statMods: { hit: 0.1 },
        inheritance: { weight: 0.5 },
      });
    });
    // (-0.4 + 0.1) × 1.1 = -0.33
    expect(deriveStats(makePet({ traits: ['t_hit_10'] }), negativeBase).hit).toBeCloseTo(-0.33, 4);

    const low = makeRepo((c) => {
      (speciesRow(c, 'fish')['base'] as Record<string, unknown>)['hit'] = -0.5;
    });
    expect(deriveStats(makePet(), low).hit).toBe(-0.5);

    const high = makeRepo((c) => {
      addTrait(c, {
        id: 't_hit_huge',
        name: '命中 +3',
        rarity: 'common',
        description: '命中 +3（用于 clamp）。',
        statMods: { hit: 3 },
        inheritance: { weight: 0.5 },
      });
    });
    expect(deriveStats(makePet({ traits: ['t_hit_huge'] }), high).hit).toBe(0.5);
  });

  it('crit/critDmg/hit/dodge 不受等级、阶段、基因、相性影响', () => {
    const low = deriveStats(makePet({ level: 1 }), makeRepo());
    const high = deriveStats(
      makePet({ level: 20, stage: 'elder', elementId: 'fire' }),
      makeRepo(),
    );
    expect(high.crit).toBe(low.crit);
    expect(high.critDmg).toBe(low.critDmg);
    expect(high.hit).toBe(low.hit);
    expect(high.dodge).toBe(low.dodge);
  });
});
