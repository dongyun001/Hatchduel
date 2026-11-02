import { describe, expect, it } from 'vitest';

import type { Profile } from '@petbattle/core';

import { DEFAULT_PVP_SETTINGS } from '../src/config.js';
import {
  eloDelta,
  invertResult,
  leaderboardValue,
  rankedGames,
  rolloverSeason,
  shanghaiDayKey,
} from '../src/domain/pvp-rules.js';

const settings = DEFAULT_PVP_SETTINGS;

function profileFixture(overrides: Partial<Profile> = {}): Profile {
  const now = 1_700_000_000_000;
  return {
    version: 1,
    accountId: 'acc_test',
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: { coin: 0, food: 0, geneDust: 0, premium: 0 },
    pets: {},
    habitats: {},
    codex: {},
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 's1' },
    settings: { sfx: true, bgm: true },
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      breeds: 0,
      hatchlings: 0,
      mutations: 0,
      released: 0,
    },
    ...overrides,
  };
}

describe('shanghaiDayKey', () => {
  it('按 Asia/Shanghai 00:00 切日', () => {
    const before = Date.UTC(2026, 0, 1, 15, 59); // 上海 2026-01-01 23:59
    const after = Date.UTC(2026, 0, 1, 16, 1); // 上海 2026-01-02 00:01
    expect(shanghaiDayKey(before)).toBe('2026-01-01');
    expect(shanghaiDayKey(after)).toBe('2026-01-02');
  });
});

describe('Elo', () => {
  it('同分胜/负/平按 K=32/24/16 计算', () => {
    expect(eloDelta(1000, 1000, 'win', settings)).toBe(16);
    expect(eloDelta(1000, 1000, 'loss', settings)).toBe(-12);
    expect(eloDelta(1000, 1000, 'draw', settings)).toBe(0);
  });

  it('高分段击败低分段收益更小，输给低分段扣更多', () => {
    const winAsFavourite = eloDelta(1200, 1000, 'win', settings);
    const lossAsFavourite = eloDelta(1200, 1000, 'loss', settings);
    expect(winAsFavourite).toBeGreaterThan(0);
    expect(winAsFavourite).toBeLessThan(16);
    expect(lossAsFavourite).toBeLessThan(-12);
  });

  it('攻守双方零和（钳到 0 之前）', () => {
    const delta = eloDelta(1000, 1100, 'win', settings);
    expect(delta).toBeGreaterThan(0);
    expect(-delta + delta).toBe(0);
  });
});

describe('invertResult', () => {
  it('win ↔ loss，draw 不变', () => {
    expect(invertResult('win')).toBe('loss');
    expect(invertResult('loss')).toBe('win');
    expect(invertResult('draw')).toBe('draw');
  });
});

describe('rolloverSeason', () => {
  it('赛季一致时不改动', () => {
    const profile = profileFixture();
    expect(rolloverSeason(profile, settings).changed).toBe(false);
  });

  it('换季软重置 rating = round((rating + 1000) / 2)，并写当前赛季', () => {
    const profile = profileFixture({
      pvp: { defense: ['p1'], rating: 1400, seasonId: 'preseason' },
    });
    const result = rolloverSeason(profile, settings);
    expect(result.changed).toBe(true);
    expect(result.profile.pvp.rating).toBe(1200);
    expect(result.profile.pvp.seasonId).toBe('s1');
    expect(result.profile.pvp.defense).toEqual(['p1']);
  });
});

describe('leaderboardValue', () => {
  it('rating 要求至少 1 场真人排位', () => {
    expect(leaderboardValue('rating', profileFixture()).eligible).toBe(false);
    const ranked = profileFixture({
      pvp: { defense: [], rating: 1234, seasonId: 's1', ranked: { wins: 1, losses: 0, draws: 0 } },
    });
    expect(leaderboardValue('rating', ranked)).toEqual({ eligible: true, value: 1234 });
    expect(rankedGames(ranked.pvp)).toBe(1);
  });

  it('codex 只算 owned，gene/generation 排除蛋', () => {
    const profile = profileFixture({
      codex: {
        'turtle:water': { seen: true, owned: true, bestGene: 50 },
        'cat:fire': { seen: true, owned: false, bestGene: 0 },
      },
    });
    expect(leaderboardValue('codex', profile)).toEqual({ eligible: true, value: 1 });

    // 只构造 leaderboardValue 读取的字段，避免测试被 PetInstance 结构变化绑死。
    const adult = {
      id: 'p1',
      stage: 'adult',
      generation: 2,
      genome: { stats: { hp: 60, atk: 40, def: 50, spd: 70 } },
    } as unknown as Profile['pets'][string];
    const egg = {
      ...adult,
      id: 'egg',
      stage: 'egg',
      generation: 99,
    } as unknown as Profile['pets'][string];

    const withPets = profileFixture({ pets: { p1: adult, egg } });
    expect(leaderboardValue('gene', withPets)).toEqual({ eligible: true, value: 55 });
    expect(leaderboardValue('generation', withPets)).toEqual({ eligible: true, value: 2 });
  });
});
