import { describe, expect, it } from 'vitest';

import {
  TimeError,
  applyPveRewards,
  type ConfigRepo,
  type PveRewardContext,
} from '@petbattle/core';

import { T0, makePet, makeProfile } from './factory.js';
import { SYNTHETIC_STAGE_ID, makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();
const stage = cfg.stage(SYNTHETIC_STAGE_ID);

function baseProfile() {
  return makeProfile(
    [
      makePet({ id: 'p1', level: 1, updatedAt: T0 }),
      makePet({ id: 'p2', level: 1, updatedAt: T0 }),
    ],
    [],
  );
}

function ctx(overrides: Partial<PveRewardContext> = {}): PveRewardContext {
  return { firstClear: true, winner: 0, partyPetIds: ['p1', 'p2'], turns: 5, ...overrides };
}

function repoWithRewardPets(pets: Array<Record<string, unknown>>): ConfigRepo {
  return makeSyntheticRepo((config) => {
    const stages = config['stages'] as Array<Record<string, unknown>>;
    const target = stages[0]!;
    const rewards = target['rewards'] as Record<string, Record<string, unknown>>;
    (rewards['firstClear'] as Record<string, unknown>)['pets'] = pets;
  });
}

describe('applyPveRewards：胜利与首通（E-03~E-06）', () => {
  it('首通：资源、经验、battlesWon、stageProgress、codex、patch', () => {
    const profile = baseProfile();
    const result = applyPveRewards(profile, stage, ctx(), T0, cfg);

    expect(result.rewards).toEqual({
      firstClear: true,
      resources: { coin: 10 },
      petExp: 10,
    });
    expect(result.profile.currencies.coin).toBe(1010);
    expect(result.profile.currencies.food).toBe(100);
    expect(result.profile.pets['p1']!.exp).toBe(10);
    expect(result.profile.pets['p2']!.exp).toBe(10);
    expect(result.profile.stats.battlesWon).toBe(1);
    expect(result.profile.stats.battlesLost).toBe(0);
    expect(result.profile.stageProgress[SYNTHETIC_STAGE_ID]).toEqual({
      cleared: true,
      bestTurns: 5,
      firstClearAt: T0,
    });
    expect(result.profile.codex['frog:water']).toEqual({
      seen: true,
      owned: false,
      bestGene: 0,
    });
    expect(result.profile.codex['fish:water']).toEqual({
      seen: true,
      owned: false,
      bestGene: 0,
    });

    expect(result.patch.fromRevision).toBe(profile.revision);
    expect(result.patch.toRevision).toBe(profile.revision);
    expect(result.patch.currencies?.coin).toBe(1010);
    expect(result.patch.pets?.upsert?.map((pet) => pet.id).sort()).toEqual(['p1', 'p2']);
    expect(result.patch.stageProgress).toBeDefined();
    expect(result.patch.stats?.battlesWon).toBe(1);
    expect(result.profile.lastEvaluatedAt).toBe(profile.lastEvaluatedAt);
  });

  it('重复通关：使用 repeat 档，bestTurns 取最小值，firstClearAt 保留', () => {
    const profile = baseProfile();
    profile.stageProgress[SYNTHETIC_STAGE_ID] = {
      cleared: true,
      bestTurns: 5,
      firstClearAt: T0 - 1000,
    };

    const result = applyPveRewards(profile, stage, ctx({ firstClear: false, turns: 3 }), T0, cfg);
    expect(result.rewards).toEqual({ firstClear: false, resources: { coin: 3 }, petExp: 3 });
    expect(result.profile.currencies.coin).toBe(1003);
    expect(result.profile.pets['p1']!.exp).toBe(3);
    expect(result.profile.stageProgress[SYNTHETIC_STAGE_ID]).toEqual({
      cleared: true,
      bestTurns: 3,
      firstClearAt: T0 - 1000,
    });
  });

  it('重复通关但更慢：bestTurns 不变', () => {
    const profile = baseProfile();
    profile.stageProgress[SYNTHETIC_STAGE_ID] = {
      cleared: true,
      bestTurns: 3,
      firstClearAt: T0 - 1000,
    };
    const result = applyPveRewards(profile, stage, ctx({ firstClear: false, turns: 9 }), T0, cfg);
    expect(result.profile.stageProgress[SYNTHETIC_STAGE_ID]!.bestTurns).toBe(3);
  });
});

describe('applyPveRewards：失败 / 平局不发奖（E-03）', () => {
  for (const winner of [1, null] as const) {
    it(`winner=${String(winner)}：无资源/经验，battlesLost++，进度不变`, () => {
      const profile = baseProfile();
      const result = applyPveRewards(
        profile,
        stage,
        ctx({ winner, firstClear: false }),
        T0,
        cfg,
      );

      expect(result.rewards).toEqual({ firstClear: false });
      expect(result.profile.currencies).toEqual(profile.currencies);
      expect(result.profile.pets['p1']!.exp).toBe(0);
      expect(result.profile.stats.battlesWon).toBe(0);
      expect(result.profile.stats.battlesLost).toBe(1);
      expect(result.profile.stageProgress[SYNTHETIC_STAGE_ID]).toBeUndefined();
      // 图鉴“见过”不区分胜负（E-06）。
      expect(result.profile.codex['frog:water']!.seen).toBe(true);
      expect(result.patch.currencies).toBeUndefined();
      expect(result.patch.pets).toBeUndefined();
    });
  }

  it('winner=1 时即使 firstClear=true 也不发首通奖励', () => {
    const profile = baseProfile();
    const result = applyPveRewards(profile, stage, ctx({ winner: 1, firstClear: true }), T0, cfg);
    expect(result.rewards).toEqual({ firstClear: false });
    expect(result.profile.currencies.coin).toBe(1000);
  });
});

describe('applyPveRewards：经验只给仍存在的队员（E-04）', () => {
  it('缺失/已放生的队员跳过，不报错', () => {
    const profile = baseProfile();
    const result = applyPveRewards(
      profile,
      stage,
      ctx({ partyPetIds: ['p1', 'ghost', 'p1'] }),
      T0,
      cfg,
    );
    expect(result.profile.pets['p1']!.exp).toBe(10);
    expect(result.profile.pets['ghost']).toBeUndefined();
    expect(result.patch.pets?.upsert?.map((pet) => pet.id)).toEqual(['p1']);
  });

  it('升级经 applyExp 结算', () => {
    const profile = baseProfile();
    profile.pets['p1'] = { ...profile.pets['p1']!, exp: 55 };
    const result = applyPveRewards(
      profile,
      stage,
      ctx({ partyPetIds: ['p1'] }),
      T0,
      cfg,
    );
    // 55 + 10 >= expToNext(1)=60 → 升到 2 级，余 5
    expect(result.profile.pets['p1']!.level).toBe(2);
    expect(result.profile.pets['p1']!.exp).toBe(5);
  });
});

describe('applyPveRewards：首通宠物以蛋交付（E-05/E-06）', () => {
  const rewardCfg = repoWithRewardPets([
    { speciesId: 'fish', elementId: 'water' },
    { speciesId: 'turtle', elementId: 'water' },
    { speciesId: 'frog', elementId: 'grass', gender: 'female' },
  ]);
  const rewardStage = rewardCfg.stage(SYNTHETIC_STAGE_ID);

  it('蛋阶段、基因 50、generation 1、性别交替、不进 breeding.eggs', () => {
    const profile = baseProfile();
    const result = applyPveRewards(profile, rewardStage, ctx(), T0, rewardCfg);

    expect(result.rewards.pets).toHaveLength(3);
    const eggs = result.rewards.pets!;
    expect(eggs.map((egg) => egg.gender)).toEqual(['male', 'female', 'female']);
    for (const egg of eggs) {
      expect(egg.stage).toBe('egg');
      expect(egg.genome.stats).toEqual({ hp: 50, atk: 50, def: 50, spd: 50 });
      expect(egg.generation).toBe(1);
      expect(egg.parents).toEqual([null, null]);
      expect(egg.traits).toEqual([]);
      expect(egg.hiddenTraits).toEqual([]);
      expect(egg.level).toBe(1);
      expect(egg.exp).toBe(0);
      expect(egg.bornAt).toBe(T0);
      expect(result.profile.pets[egg.id]).toEqual(egg);
    }
    expect(eggs.map((egg) => egg.id)).toEqual([
      `reward_${SYNTHETIC_STAGE_ID}_0`,
      `reward_${SYNTHETIC_STAGE_ID}_1`,
      `reward_${SYNTHETIC_STAGE_ID}_2`,
    ]);
    expect(result.profile.breeding.eggs).toEqual([]);
    expect(result.profile.breeding.cooldowns).toEqual({});

    expect(result.profile.codex['fish:water']).toEqual({
      seen: true,
      owned: true,
      bestGene: 50,
    });
    expect(result.profile.codex['frog:grass']).toEqual({
      seen: true,
      owned: true,
      bestGene: 50,
    });
  });

  it('重复通关不再发首通宠物', () => {
    const profile = baseProfile();
    const result = applyPveRewards(
      profile,
      rewardStage,
      ctx({ firstClear: false }),
      T0,
      rewardCfg,
    );
    expect(result.rewards.pets).toBeUndefined();
    expect(Object.keys(result.profile.pets).sort()).toEqual(['p1', 'p2']);
  });

  it('奖励蛋 id 被占用时追加序号（防御性确定性）', () => {
    const profile = baseProfile();
    profile.pets[`reward_${SYNTHETIC_STAGE_ID}_0`] = makePet({
      id: `reward_${SYNTHETIC_STAGE_ID}_0`,
    });
    const result = applyPveRewards(profile, rewardStage, ctx(), T0, rewardCfg);
    const ids = result.rewards.pets!.map((egg) => egg.id);
    expect(ids[0]).toBe(`reward_${SYNTHETIC_STAGE_ID}_0_1`);
    expect(ids[1]).toBe(`reward_${SYNTHETIC_STAGE_ID}_1`);
  });

  it('同一输入两次结算得到相同的奖励蛋', () => {
    const first = applyPveRewards(baseProfile(), rewardStage, ctx(), T0, rewardCfg);
    const second = applyPveRewards(baseProfile(), rewardStage, ctx(), T0, rewardCfg);
    expect(second.rewards.pets).toEqual(first.rewards.pets);
  });
});

describe('applyPveRewards：边界', () => {
  it('时间倒退抛 TimeError', () => {
    expect(() => applyPveRewards(baseProfile(), stage, ctx(), T0 - 1, cfg)).toThrow(TimeError);
  });

  it('不修改入参 profile', () => {
    const profile = baseProfile();
    const before = JSON.stringify(profile);
    applyPveRewards(profile, stage, ctx(), T0, cfg);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('没有 repeat 奖励配置时只有 stats 变化', () => {
    const noRewards = makeSyntheticRepo((config) => {
      const stages = config['stages'] as Array<Record<string, unknown>>;
      (stages[0]!['rewards'] as Record<string, unknown>)['repeat'] = {};
    });
    const profile = baseProfile();
    const result = applyPveRewards(
      profile,
      noRewards.stage(SYNTHETIC_STAGE_ID),
      ctx({ firstClear: false }),
      T0,
      noRewards,
    );
    expect(result.rewards).toEqual({ firstClear: false });
    expect(result.profile.stats.battlesWon).toBe(1);
    expect(result.profile.stageProgress[SYNTHETIC_STAGE_ID]!.cleared).toBe(true);
  });
});
