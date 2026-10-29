import { describe, expect, it } from 'vitest';

import {
  breed,
  checkBreeding,
  isInbred,
  type PetInstance,
} from '@petbattle/core';
import { mulberry32 } from '../src/rng.js';
import { breedingCooldownMs } from '../src/breeding.js';

import { HOUR, T0, addTrait, makePet, makeProfile, makeRepo } from './factory.js';

function pair(overrides: { a?: Parameters<typeof makePet>[0]; b?: Parameters<typeof makePet>[0] } = {}) {
  const a = makePet({ id: 'a', gender: 'male', ...overrides.a });
  const b = makePet({ id: 'b', gender: 'female', ...overrides.b });
  return { a, b };
}

describe('isInbred：3 代内共同祖先（DOMAIN §8.3）', () => {
  it('共同祖先落在 maxDepth 以内为近亲', () => {
    const a = makePet({ id: 'a', ancestors: [{ id: 'gp', depth: 2 }] });
    const b = makePet({ id: 'b', ancestors: [{ id: 'gp', depth: 3 }] });
    expect(isInbred(a, b, 3)).toBe(true);
    expect(isInbred(b, a, 3)).toBe(true);
  });

  it('超过 maxDepth 不算近亲', () => {
    const a = makePet({ id: 'a', ancestors: [{ id: 'gp', depth: 4 }] });
    const b = makePet({ id: 'b', ancestors: [{ id: 'gp', depth: 4 }] });
    expect(isInbred(a, b, 3)).toBe(false);
    expect(isInbred(a, b, 4)).toBe(true);
  });

  it('自身出现在对方祖先里也算近亲', () => {
    const a = makePet({ id: 'a' });
    const b = makePet({ id: 'b', ancestors: [{ id: 'a', depth: 1 }] });
    expect(isInbred(a, b, 3)).toBe(true);
  });

  it('无交集不算近亲', () => {
    const a = makePet({ id: 'a', ancestors: [{ id: 'x', depth: 1 }] });
    const b = makePet({ id: 'b', ancestors: [{ id: 'y', depth: 2 }] });
    expect(isInbred(a, b, 3)).toBe(false);
  });
});

describe('checkBreeding：校验顺序（DOMAIN §8.1）', () => {
  const cfg = makeRepo();

  it('基础条件满足时 ok', () => {
    const { a, b } = pair();
    const check = checkBreeding(a, b, T0, makeProfile([a, b], [a.id, b.id]), cfg);
    expect(check).toEqual({ ok: true, inbred: false });
  });

  it('同一只 → same_pet（优先级最高）', () => {
    const a = makePet({ id: 'a', gender: 'male' });
    expect(
      checkBreeding(a, a, T0, makeProfile([a], []), cfg).reason,
    ).toBe('same_pet');
  });

  it('同性 → same_gender', () => {
    const { a, b } = pair({ b: { gender: 'male' } });
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfg).reason).toBe('same_gender');
  });

  it('蛋 / 幼年 → not_adult', () => {
    const { a, b } = pair({ a: { stage: 'egg' }, b: { stage: 'juvenile' } });
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfg).reason).toBe('not_adult');
  });

  it('锁定 → locked（优先于可繁殖时间）', () => {
    const { a, b } = pair({
      a: { locked: true, fertility: { readyAt: T0 + HOUR } },
    });
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfg).reason).toBe('locked');
  });

  it('未到 readyAt → infertile', () => {
    const { a, b } = pair({ a: { fertility: { readyAt: T0 + 1 } } });
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfg).reason).toBe('infertile');
  });

  it('冷却中 → cooldown', () => {
    const { a, b } = pair({ b: { fertility: { cooldownUntil: T0 + 1 } } });
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfg).reason).toBe('cooldown');

    const profile = makeProfile([a, b], []);
    profile.breeding.cooldowns = { [b.id]: T0 + 1 };
    expect(checkBreeding(a, b, T0, profile, cfg).reason).toBe('cooldown');
  });

  it('没有空位 → no_capacity（宠物 + 蛋占满）', () => {
    const { a, b } = pair();
    const pets = [
      a,
      b,
      makePet({ id: 'c' }),
      makePet({ id: 'd' }),
    ];
    expect(checkBreeding(a, b, T0, makeProfile(pets, []), cfg).reason).toBe('no_capacity');

    const withEgg = makeProfile([a, b, makePet({ id: 'c' })], []);
    withEgg.breeding.eggs = ['egg_1'];
    expect(checkBreeding(a, b, T0, withEgg, cfg).reason).toBe('no_capacity');
  });

  it('资源不足 → cost', () => {
    const { a, b } = pair();
    const profile = makeProfile([a, b], []);
    profile.currencies.food = 0;
    expect(checkBreeding(a, b, T0, profile, cfg).reason).toBe('cost');
  });

  it('近亲不阻断，只标记 inbred', () => {
    const { a, b } = pair({
      a: { ancestors: [{ id: 'gp', depth: 2 }] },
      b: { ancestors: [{ id: 'gp', depth: 1 }] },
    });
    const check = checkBreeding(a, b, T0, makeProfile([a, b], []), cfg);
    expect(check.ok).toBe(true);
    expect(check.inbred).toBe(true);
  });

  it('物种不可繁殖 → infertile', () => {
    const cfgNoBreed = makeRepo((config) => {
      const species = (config['species'] as Array<Record<string, unknown>>).find(
        (item) => item['id'] === 'fish',
      );
      if (species) species['breedable'] = false;
    });
    const { a, b } = pair();
    expect(checkBreeding(a, b, T0, makeProfile([a, b], []), cfgNoBreed).reason).toBe('infertile');
  });
});

describe('breed：遗传算法（DOMAIN §8.2）', () => {
  const cfg = makeRepo();

  it('同种子同结果（确定性）', () => {
    const { a, b } = pair();
    const first = breed(a, b, T0, cfg, mulberry32(2024));
    const second = breed(a, b, T0, cfg, mulberry32(2024));
    expect(second.child).toEqual(first.child);
    expect(second.inbred).toBe(false);
  });

  it('子代为蛋，出生于 now，readyAt = now + hatch + juvenile', () => {
    const { a, b } = pair();
    const { child } = breed(a, b, T0, cfg, mulberry32(1));
    const breeding = cfg.breeding();
    expect(child.stage).toBe('egg');
    expect(child.bornAt).toBe(T0);
    expect(child.stageChangedAt).toBe(T0);
    expect(child.createdAt).toBe(T0);
    expect(child.fertility.readyAt).toBe(T0 + breeding.hatchMs + breeding.juvenileMs);
    expect(child.fertility.cooldownUntil).toBe(0);
    expect(child.fertility.penalty).toBe(0);
    expect(child.level).toBe(1);
    expect(child.exp).toBe(0);
    expect(child.condition).toEqual({ hunger: 100, mood: 100, hygiene: 100, health: 100 });
    expect(child.habitatId).toBeNull();
    expect(child.locked).toBe(false);
    expect(child.id).toBe(`egg_a_b_${T0}`);
  });

  it('物种 50/50：两个物种都会出现', () => {
    const a = makePet({ id: 'a', speciesId: 'fish', gender: 'male' });
    const b = makePet({ id: 'b', speciesId: 'turtle', gender: 'female' });
    const counts = { fish: 0, turtle: 0 };
    for (let seed = 0; seed < 400; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      if (child.speciesId === 'fish') counts.fish += 1;
      if (child.speciesId === 'turtle') counts.turtle += 1;
    }
    expect(counts.fish).toBeGreaterThan(120);
    expect(counts.turtle).toBeGreaterThan(120);
    expect(counts.fish + counts.turtle).toBe(400);
  });

  it('属性继承父母之一，基因在 0~100 且均值贴近父母均值', () => {
    const { a, b } = pair({ a: { genome: undefined }, b: { genome: undefined } });
    let total = 0;
    const samples = 300;
    for (let seed = 0; seed < samples; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      for (const key of ['hp', 'atk', 'def', 'spd'] as const) {
        const gene = child.genome.stats[key];
        expect(gene).toBeGreaterThanOrEqual(0);
        expect(gene).toBeLessThanOrEqual(100);
        expect(Number.isInteger(gene)).toBe(true);
        total += gene;
      }
    }
    const mean = total / (samples * 4);
    expect(mean).toBeGreaterThan(58);
    expect(mean).toBeLessThan(62);
  });

  it('1% 属性突变：偶发但确实发生', () => {
    const { a, b } = pair({
      a: { elementId: 'water' },
      b: { elementId: 'water' },
    });
    let mutations = 0;
    const samples = 3000;
    for (let seed = 0; seed < samples; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      if (child.genome.mutationCount > 0 && child.elementId !== 'water') mutations += 1;
      expect(['water', 'fire', 'grass', 'earth', 'thunder']).toContain(child.elementId);
    }
    // 期望 ~30；给足统计余量。
    expect(mutations).toBeGreaterThan(5);
    expect(mutations).toBeLessThan(80);
  });

  it('近亲：基因 -5、特质突变 +2%、子代 fertility.penalty = 0.2', () => {
    const { a, b } = pair({
      a: { ancestors: [{ id: 'gp', depth: 2 }] },
      b: { ancestors: [{ id: 'gp', depth: 2 }] },
    });
    let total = 0;
    const samples = 300;
    for (let seed = 0; seed < samples; seed += 1) {
      const { child, inbred } = breed(a, b, T0, cfg, mulberry32(seed));
      expect(inbred).toBe(true);
      expect(child.fertility.penalty).toBe(0.2);
      total += child.genome.stats.atk;
    }
    const mean = total / samples;
    expect(mean).toBeGreaterThan(52);
    expect(mean).toBeLessThan(58);
  });

  it('显性特质必表达，隐性特质按 50% 保留', () => {
    const { a, b } = pair({
      a: { traits: ['trait_sturdy'], hiddenTraits: ['trait_swift'] },
      b: { traits: ['trait_sturdy'], hiddenTraits: ['trait_swift'] },
    });
    let hiddenExpress = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      expect(child.traits).toContain('trait_sturdy');
      if (child.hiddenTraits.includes('trait_swift')) hiddenExpress += 1;
    }
    expect(hiddenExpress).toBeGreaterThan(140);
    expect(hiddenExpress).toBeLessThan(260);
  });

  it('3% 特质突变：偶发且计入 mutationCount', () => {
    const { a, b } = pair();
    let mutated = 0;
    const samples = 3000;
    for (let seed = 0; seed < samples; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      if (child.traits.length > 0 || child.hiddenTraits.length > 0) {
        mutated += 1;
        expect(child.genome.mutationCount).toBeGreaterThanOrEqual(1);
      }
    }
    expect(mutated).toBeGreaterThan(30);
    expect(mutated).toBeLessThan(160);
  });

  it('特质数量受 maxExpressedTraits 限制，超限按稀有度裁剪', () => {
    const { a, b } = pair({
      a: {
        traits: ['trait_sturdy', 'trait_swift', 'trait_lucky', 'trait_legendary_blood'],
      },
      b: { traits: ['trait_sturdy'] },
    });
    for (let seed = 0; seed < 50; seed += 1) {
      const { child } = breed(a, b, T0, cfg, mulberry32(seed));
      expect(child.traits.length).toBeLessThanOrEqual(cfg.breeding().maxExpressedTraits);
      expect(child.traits).toContain('trait_legendary_blood');
      expect(child.traits).toContain('trait_lucky');
    }
  });

  it('代数 = max(父母)+1；祖先去重保留最小深度', () => {
    const { a, b } = pair({
      a: { generation: 2, ancestors: [{ id: 'gp', depth: 2 }] },
      b: { generation: 5, ancestors: [{ id: 'gp', depth: 1 }] },
    });
    const { child } = breed(a, b, T0, cfg, mulberry32(7));
    expect(child.generation).toBe(6);
    expect(child.parents).toEqual(['a', 'b']);

    const ids = child.ancestors.map((ref) => ref.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('gp');
    expect(ids.filter((id) => id === 'gp')).toHaveLength(1);
    expect(child.ancestors.find((ref) => ref.id === 'gp')?.depth).toBe(2);
    for (const ref of child.ancestors) expect(ref.depth).toBeLessThanOrEqual(3);
  });

  it('父母物种/属性进入等位基因', () => {
    const { a, b } = pair({
      a: { speciesId: 'fish', elementId: 'water' },
      b: { speciesId: 'turtle', elementId: 'earth' },
    });
    const { child } = breed(a, b, T0, cfg, mulberry32(3));
    expect(child.genome.speciesAlleles).toEqual(['fish', 'turtle']);
    expect(child.genome.elementAlleles).toEqual(['water', 'earth']);
  });

  it('性别随机：两种都出现', () => {
    const { a, b } = pair();
    const genders = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) {
      genders.add(breed(a, b, T0, cfg, mulberry32(seed)).child.gender);
    }
    expect(genders).toEqual(new Set(['male', 'female']));
  });

  it('父母冷却：普通 2h、近亲 ×1.2、老年 ×2，并由 breed 直接返回（D-02）', () => {
    const cfg2 = makeRepo();
    const normal = makePet({ id: 'n' });
    const elder = makePet({ id: 'e', stage: 'elder' });

    expect(breedingCooldownMs(normal, false, cfg2)).toBe(2 * HOUR);
    expect(breedingCooldownMs(normal, true, cfg2)).toBe(Math.floor(2 * HOUR * 1.2));
    expect(breedingCooldownMs(elder, false, cfg2)).toBe(4 * HOUR);
    expect(breedingCooldownMs(elder, true, cfg2)).toBe(Math.floor(2 * HOUR * 1.2 * 2));

    const ordinary = breed(normal, makePet({ id: 'f', gender: 'female' }), T0, cfg2, mulberry32(5));
    expect(ordinary.parentCooldowns).toEqual([T0 + 2 * HOUR, T0 + 2 * HOUR]);

    const inbredA = makePet({ id: 'ia', ancestors: [{ id: 'gp', depth: 2 }] });
    const inbredB = makePet({ id: 'ib', gender: 'female', ancestors: [{ id: 'gp', depth: 2 }] });
    const inbred = breed(inbredA, inbredB, T0, cfg2, mulberry32(6));
    expect(inbred.parentCooldowns).toEqual([
      T0 + Math.floor(2 * HOUR * 1.2),
      T0 + Math.floor(2 * HOUR * 1.2),
    ]);

    const withElder = breed(elder, makePet({ id: 'g', gender: 'female' }), T0, cfg2, mulberry32(7));
    expect(withElder.parentCooldowns).toEqual([T0 + 4 * HOUR, T0 + 2 * HOUR]);
  });

  it('自定义特质池：突变只从池里挑', () => {
    const cfgCustom = makeRepo((config) => {
      addTrait(config, {
        id: 'trait_extra',
        name: '额外',
        rarity: 'epic',
        description: '测试用。',
        statMods: { hp: 1.2 },
        inheritance: { weight: 0.1 },
      });
    });
    const { a, b } = pair();
    const found = new Set<string>();
    for (let seed = 0; seed < 500; seed += 1) {
      const { child } = breed(a, b, T0, cfgCustom, mulberry32(seed));
      for (const traitId of [...child.traits, ...child.hiddenTraits]) found.add(traitId);
    }
    for (const traitId of found) {
      expect(cfgCustom.trait(traitId).id).toBe(traitId);
    }
  });
});

describe('breed：返回对象不可变', () => {
  it('breed 不修改父母', () => {
    const { a, b } = pair();
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    breed(a, b, T0, makeRepo(), mulberry32(1));
    expect(JSON.stringify(a)).toBe(beforeA);
    expect(JSON.stringify(b)).toBe(beforeB);
  });

  it('类型收窄：child 是 PetInstance', () => {
    const { a, b } = pair();
    const result: PetInstance = breed(a, b, T0, makeRepo(), mulberry32(2)).child;
    expect(result.speciesId.length).toBeGreaterThan(0);
  });
});
