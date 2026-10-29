import { describe, expect, it } from 'vitest';

import { ReleaseError, releasePet } from '@petbattle/core';

import { T0, makePet, makeProfile } from './factory.js';

describe('releasePet：五类拒绝（DOMAIN §8.6 / P-026 / P-035）', () => {
  it('宠物不存在 → pet_not_found', () => {
    const profile = makeProfile([], []);
    expect(() => releasePet(profile, 'ghost', T0)).toThrow(ReleaseError);
    try {
      releasePet(profile, 'ghost', T0);
    } catch (error) {
      expect((error as ReleaseError).reason).toBe('pet_not_found');
    }
  });

  it('蛋不可放生 → cannot_release_egg', () => {
    const egg = makePet({ id: 'egg', stage: 'egg' });
    const profile = makeProfile([egg, makePet({ id: 'adult' })], []);
    expect(() => releasePet(profile, 'egg', T0)).toThrow(/(cannot_release_egg)/);
  });

  it('锁定不可放生 → pet_locked', () => {
    const pet = makePet({ id: 'p', locked: true });
    const profile = makeProfile([pet, makePet({ id: 'other' })], []);
    expect(() => releasePet(profile, 'p', T0)).toThrow(/pet_locked/);
  });

  it('上阵不可放生 → in_lineup', () => {
    const pet = makePet({ id: 'p' });
    const profile = makeProfile([pet, makePet({ id: 'other' })], []);
    profile.lineup = ['p'];
    expect(() => releasePet(profile, 'p', T0)).toThrow(/in_lineup/);
  });

  it('栖息地中不可放生 → in_habitat（habitatId 或槽位任一命中）', () => {
    const byId = makePet({ id: 'p', habitatId: 'meadow' });
    const profileA = makeProfile([byId, makePet({ id: 'other' })], []);
    expect(() => releasePet(profileA, 'p', T0)).toThrow(/in_habitat/);

    const bySlot = makePet({ id: 'q', habitatId: null });
    const profileB = makeProfile([bySlot, makePet({ id: 'other' })], ['q']);
    expect(() => releasePet(profileB, 'q', T0)).toThrow(/in_habitat/);
  });

  it('最后一只成年/老年不可放生 → last_adult', () => {
    const adult = makePet({ id: 'p', stage: 'adult' });
    const profile = makeProfile([adult], []);
    expect(() => releasePet(profile, 'p', T0)).toThrow(/last_adult/);

    // 幼年不算成年，放走唯一成年会软锁。
    const withJuvenile = makeProfile(
      [adult, makePet({ id: 'kid', stage: 'juvenile' })],
      [],
    );
    expect(() => releasePet(withJuvenile, 'p', T0)).toThrow(/last_adult/);
  });
});

describe('releasePet：成功路径', () => {
  it('移除宠物、返还基因尘、stats.released +1', () => {
    const target = makePet({ id: 'p', level: 1 });
    const keeper = makePet({ id: 'keep', stage: 'adult' });
    const profile = makeProfile([target, keeper], []);

    const result = releasePet(profile, 'p', T0);

    expect(result.profile.pets['p']).toBeUndefined();
    expect(result.profile.pets['keep']).toEqual(keeper);
    expect(result.profile.stats.released).toBe(1);
    // 5 + 1×2 + (60×4)/10 = 31
    expect(result.refund).toEqual({ geneDust: 31 });
  });

  it('图鉴 owned 不回退，其他统计不变', () => {
    const target = makePet({ id: 'p' });
    const keeper = makePet({ id: 'keep', stage: 'adult' });
    const profile = makeProfile([target, keeper], []);
    profile.codex['fish:water'] = { seen: true, owned: true, bestGene: 70 };
    profile.stats.battlesWon = 3;

    const result = releasePet(profile, 'p', T0);
    expect(result.profile.codex['fish:water']).toEqual({
      seen: true,
      owned: true,
      bestGene: 70,
    });
    expect(result.profile.stats.battlesWon).toBe(3);
  });

  it('有两只成年时可以放走一只（含老年）', () => {
    const elder = makePet({ id: 'old', stage: 'elder' });
    const adult = makePet({ id: 'young', stage: 'adult' });
    const profile = makeProfile([elder, adult], []);
    expect(() => releasePet(profile, 'old', T0)).not.toThrow();
  });

  it('幼年不触发 last_adult 保护', () => {
    const kid = makePet({ id: 'kid', stage: 'juvenile' });
    const adult = makePet({ id: 'a', stage: 'adult' });
    const profile = makeProfile([kid, adult], []);
    const result = releasePet(profile, 'kid', T0);
    expect(result.profile.pets['kid']).toBeUndefined();
    expect(result.profile.pets['a']).toBeDefined();
  });

  it('不修改入参 profile', () => {
    const target = makePet({ id: 'p' });
    const keeper = makePet({ id: 'keep' });
    const profile = makeProfile([target, keeper], []);
    const before = JSON.stringify(profile);
    releasePet(profile, 'p', T0);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('低等级高基因也能拿到至少 1 基因尘', () => {
    const target = makePet({
      id: 'p',
      level: 1,
      genome: {
        stats: { hp: 0, atk: 0, def: 0, spd: 0 },
        speciesAlleles: ['fish', 'fish'],
        elementAlleles: ['water', 'water'],
        traitAlleles: [],
        mutationCount: 0,
      },
    });
    const profile = makeProfile([target, makePet({ id: 'keep' })], []);
    const result = releasePet(profile, 'p', T0);
    expect(result.refund.geneDust).toBeGreaterThanOrEqual(1);
  });
});
