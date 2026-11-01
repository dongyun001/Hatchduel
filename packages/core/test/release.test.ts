import { describe, expect, it } from 'vitest';

import { ReleaseError, releasePet } from '@petbattle/core';

import { T0, makePet, makeProfile, makeRepo } from './factory.js';

const cfg = makeRepo();

describe('releasePet：五类拒绝（DOMAIN §8.6 / P-026 / P-035）', () => {
  it('宠物不存在 → pet_not_found', () => {
    const profile = makeProfile([], []);
    expect(() => releasePet(profile, 'ghost', T0, cfg)).toThrow(ReleaseError);
    try {
      releasePet(profile, 'ghost', T0, cfg);
    } catch (error) {
      expect((error as ReleaseError).reason).toBe('pet_not_found');
    }
  });

  it('蛋不可放生 → cannot_release_egg', () => {
    const egg = makePet({ id: 'egg', stage: 'egg' });
    const profile = makeProfile([egg, makePet({ id: 'adult' })], []);
    expect(() => releasePet(profile, 'egg', T0, cfg)).toThrow(/(cannot_release_egg)/);
  });

  it('锁定不可放生 → pet_locked', () => {
    const pet = makePet({ id: 'p', locked: true });
    const profile = makeProfile([pet, makePet({ id: 'other' })], []);
    expect(() => releasePet(profile, 'p', T0, cfg)).toThrow(/pet_locked/);
  });

  it('防守阵容中不可放生 → in_defense（D-11）；移出后可放生', () => {
    const pet = makePet({ id: 'p' });
    const profile = makeProfile([pet, makePet({ id: 'keep' })], []);
    profile.pvp.defense = ['p'];

    try {
      releasePet(profile, 'p', T0, cfg);
      throw new Error('expected ReleaseError');
    } catch (error) {
      expect(error).toBeInstanceOf(ReleaseError);
      expect((error as ReleaseError).reason).toBe('in_defense');
    }

    profile.pvp.defense = [];
    const result = releasePet(profile, 'p', T0, cfg);
    expect(result.profile.pets['p']).toBeUndefined();
  });

  it('上阵不可放生 → in_lineup', () => {
    const pet = makePet({ id: 'p' });
    const profile = makeProfile([pet, makePet({ id: 'other' })], []);
    profile.lineup = ['p'];
    expect(() => releasePet(profile, 'p', T0, cfg)).toThrow(/in_lineup/);
  });

  it('栖息地中不可放生 → in_habitat（habitatId 或槽位任一命中）', () => {
    const byId = makePet({ id: 'p', habitatId: 'meadow' });
    const profileA = makeProfile([byId, makePet({ id: 'other' })], []);
    expect(() => releasePet(profileA, 'p', T0, cfg)).toThrow(/in_habitat/);

    const bySlot = makePet({ id: 'q', habitatId: null });
    const profileB = makeProfile([bySlot, makePet({ id: 'other' })], ['q']);
    expect(() => releasePet(profileB, 'q', T0, cfg)).toThrow(/in_habitat/);
  });

  it('放生已孵化但未领取的个体时清理 breeding.eggs（P-121）', () => {
    const pet = makePet({ id: 'p', stage: 'juvenile' });
    const profile = makeProfile([pet, makePet({ id: 'keep', stage: 'adult' })], []);
    profile.breeding.eggs = ['p'];

    const result = releasePet(profile, 'p', T0, cfg);
    expect(result.profile.pets['p']).toBeUndefined();
    expect(result.profile.breeding.eggs).toEqual([]);
  });

  it('最后一只成年/老年不可放生 → last_adult', () => {
    const adult = makePet({ id: 'p', stage: 'adult' });
    const profile = makeProfile([adult], []);
    expect(() => releasePet(profile, 'p', T0, cfg)).toThrow(/last_adult/);

    // 幼年不算成年，放走唯一成年会软锁。
    const withJuvenile = makeProfile(
      [adult, makePet({ id: 'kid', stage: 'juvenile' })],
      [],
    );
    expect(() => releasePet(withJuvenile, 'p', T0, cfg)).toThrow(/last_adult/);
  });
});

describe('releasePet：成功路径与返还（contract-v1.2 D-01）', () => {
  it('移除宠物、返还基因尘、stats.released +1', () => {
    const target = makePet({ id: 'p', level: 1 });
    const keeper = makePet({ id: 'keep', stage: 'adult' });
    const profile = makeProfile([target, keeper], []);

    const result = releasePet(profile, 'p', T0, cfg);

    expect(result.profile.pets['p']).toBeUndefined();
    expect(result.profile.pets['keep']).toEqual(keeper);
    expect(result.profile.stats.released).toBe(1);
    // economy: 5 + 1×2 + (60×4)/10 = 31，无特质加成
    expect(result.refund).toEqual({ geneDust: 31 });
  });

  it('特质稀有度加成全部计入（common 1 / rare 3 / epic 8）', () => {
    const target = makePet({
      id: 'p',
      level: 3,
      traits: ['trait_sturdy', 'trait_lucky', 'trait_legendary_blood'],
    });
    const profile = makeProfile([target, makePet({ id: 'keep' })], []);
    const result = releasePet(profile, 'p', T0, cfg);
    // 5 + 3×2 + 24 + (1 + 3 + 8) = 47
    expect(result.refund.geneDust).toBe(47);
  });

  it('已删除的特质按 0 计，旧档不会因此报错', () => {
    const target = makePet({ id: 'p', traits: ['trait_removed'] });
    const profile = makeProfile([target, makePet({ id: 'keep' })], []);
    const result = releasePet(profile, 'p', T0, cfg);
    expect(result.refund.geneDust).toBe(31);
  });

  it('返还公式完全由 economy.releaseRefund 驱动', () => {
    const custom = makeRepo((config) => {
      const economy = config['economy'] as Record<string, unknown>;
      const refund = economy['releaseRefund'] as Record<string, unknown>;
      refund['base'] = 100;
      refund['perLevel'] = 0;
      refund['perGeneSumDivisor'] = 1000;
      (refund['rarityBonus'] as Record<string, number>)['epic'] = 50;
    });
    const target = makePet({ id: 'p', traits: ['trait_legendary_blood'] });
    const profile = makeProfile([target, makePet({ id: 'keep' })], []);
    const result = releasePet(profile, 'p', T0, custom);
    expect(result.refund.geneDust).toBe(150);
  });

  it('图鉴 owned 不回退，其他统计不变', () => {
    const target = makePet({ id: 'p' });
    const keeper = makePet({ id: 'keep', stage: 'adult' });
    const profile = makeProfile([target, keeper], []);
    profile.codex['fish:water'] = { seen: true, owned: true, bestGene: 70 };
    profile.stats.battlesWon = 3;

    const result = releasePet(profile, 'p', T0, cfg);
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
    expect(() => releasePet(profile, 'old', T0, cfg)).not.toThrow();
  });

  it('幼年不触发 last_adult 保护', () => {
    const kid = makePet({ id: 'kid', stage: 'juvenile' });
    const adult = makePet({ id: 'a', stage: 'adult' });
    const profile = makeProfile([kid, adult], []);
    const result = releasePet(profile, 'kid', T0, cfg);
    expect(result.profile.pets['kid']).toBeUndefined();
    expect(result.profile.pets['a']).toBeDefined();
  });

  it('不修改入参 profile', () => {
    const target = makePet({ id: 'p' });
    const keeper = makePet({ id: 'keep' });
    const profile = makeProfile([target, keeper], []);
    const before = JSON.stringify(profile);
    releasePet(profile, 'p', T0, cfg);
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
    const result = releasePet(profile, 'p', T0, cfg);
    expect(result.refund.geneDust).toBeGreaterThanOrEqual(1);
  });
});
