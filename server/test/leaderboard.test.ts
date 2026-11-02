import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CodexEntry, CodexKey } from '@petbattle/core';
import type { LeaderboardResponse } from '@petbattle/protocol';

import {
  authHeaders,
  expectError,
  get,
  replaceProfile,
  startTestServer,
  type HttpCall,
  type TestHarness,
} from './helpers.js';
import {
  fight,
  getOpponent,
  loginPvp,
  opponentOf,
  prepareFighter,
  type PvpAccount,
} from './pvp-helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await startTestServer();
});

afterEach(async () => {
  await harness.close();
});

async function board(account: PvpAccount, query: string): Promise<HttpCall> {
  return get(harness, `/leaderboard?${query}`, authHeaders(account.token));
}

function dataOf(call: HttpCall): LeaderboardResponse {
  return call.body.data as LeaderboardResponse;
}

async function addCodex(account: PvpAccount, key: CodexKey, entry: CodexEntry): Promise<void> {
  await replaceProfile(harness, account.accountId, (profile) => ({
    ...profile,
    codex: { ...profile.codex, [key]: entry },
  }));
}

async function setRating(account: PvpAccount, rating: number): Promise<void> {
  await replaceProfile(harness, account.accountId, (profile) => ({
    ...profile,
    pvp: { ...profile.pvp, rating, seasonId: 's1' },
  }));
}

describe('GET /leaderboard：资格与取值', () => {
  it('codex 只算 owned，seen 剪影不计', async () => {
    const a = await loginPvp(harness, 'lb-codex-a');
    const before = await board(a, 'kind=codex');
    expect(before.status).toBe(200);
    expect(dataOf(before).selfEligible).toBe(true);
    expect(dataOf(before).self?.value).toBe(3);

    await addCodex(a, 'cat:fire', { seen: true, owned: false, bestGene: 0 });
    expect(dataOf(await board(a, 'kind=codex')).self?.value).toBe(3);

    await addCodex(a, 'cat:fire', { seen: true, owned: true, bestGene: 90 });
    expect(dataOf(await board(a, 'kind=codex')).self?.value).toBe(4);
  });

  it('gene 取非蛋宠物四项基因均值的最大值', async () => {
    const a = await loginPvp(harness, 'lb-gene-a');
    expect(dataOf(await board(a, 'kind=gene')).self?.value).toBe(50);

    await replaceProfile(harness, a.accountId, (profile) => {
      const pet = Object.values(profile.pets)[0];
      if (pet === undefined) throw new Error('缺少宠物');
      return {
        ...profile,
        pets: {
          ...profile.pets,
          pet_high_gene: {
            ...pet,
            id: 'pet_high_gene',
            stage: 'adult',
            genome: {
              ...pet.genome,
              stats: { hp: 80, atk: 80, def: 80, spd: 80 },
            },
          },
          pet_egg_high_gene: {
            ...pet,
            id: 'pet_egg_high_gene',
            stage: 'egg',
            genome: {
              ...pet.genome,
              stats: { hp: 100, atk: 100, def: 100, spd: 100 },
            },
          },
        },
      };
    });

    expect(dataOf(await board(a, 'kind=gene')).self?.value).toBe(80);
  });

  it('generation 取非蛋宠物最大值，蛋不计', async () => {
    const a = await loginPvp(harness, 'lb-gen-a');
    expect(dataOf(await board(a, 'kind=generation')).self?.value).toBe(1);

    await replaceProfile(harness, a.accountId, (profile) => {
      const pet = Object.values(profile.pets)[0];
      if (pet === undefined) throw new Error('缺少宠物');
      return {
        ...profile,
        pets: {
          ...profile.pets,
          pet_gen3: { ...pet, id: 'pet_gen3', stage: 'adult', generation: 3 },
          pet_egg_gen99: { ...pet, id: 'pet_egg_gen99', stage: 'egg', generation: 99 },
        },
      };
    });

    expect(dataOf(await board(a, 'kind=generation')).self?.value).toBe(3);
  });

  it('rating 榜只含至少 1 场真人排位的账号；机器人对局不算', async () => {
    const a = await loginPvp(harness, 'lb-rating-a');
    const fresh = await board(a, 'kind=rating');
    expect(dataOf(fresh).selfEligible).toBe(false);
    expect(dataOf(fresh).self).toBeUndefined();

    await prepareFighter(harness, a, 'lb-rating-bot');
    const bot = opponentOf(await getOpponent(harness, a)).opponent;
    const botFight = await fight(harness, a, bot.accountId, 'lb-rating-bot-fight');
    expect(botFight.status).toBe(200);
    expect(dataOf(await board(a, 'kind=rating')).selfEligible).toBe(false);
  });
});

describe('GET /leaderboard：排序、self 与 limit', () => {
  it('value desc → rating desc → accountId asc', async () => {
    const highRating = await loginPvp(harness, 'lb-sort-hr');
    const lowRating = await loginPvp(harness, 'lb-sort-lr');
    const lowerValue = await loginPvp(harness, 'lb-sort-lv');

    for (const account of [highRating, lowRating]) {
      await addCodex(account, 'cat:fire', { seen: true, owned: true, bestGene: 0 });
      await addCodex(account, 'snake:earth', { seen: true, owned: true, bestGene: 0 });
    }
    await addCodex(lowerValue, 'cat:fire', { seen: true, owned: true, bestGene: 0 });

    await setRating(highRating, 1200);
    await setRating(lowRating, 1000);
    await setRating(lowerValue, 1500);

    const result = dataOf(await board(highRating, 'kind=codex'));
    expect(result.entries.map((entry) => entry.accountId).slice(0, 2)).toEqual([
      highRating.accountId,
      lowRating.accountId,
    ]);
    expect(result.entries.map((entry) => entry.accountId).slice(2, 3)).toEqual([
      lowerValue.accountId,
    ]);
  });

  it('limit 默认 20、最大 50；self 即使不在前 N 也返回真实排名', async () => {
    const first = await loginPvp(harness, 'lb-limit-1');
    const second = await loginPvp(harness, 'lb-limit-2');
    const last = await loginPvp(harness, 'lb-limit-3');

    await addCodex(first, 'cat:fire', { seen: true, owned: true, bestGene: 0 });
    await addCodex(second, 'cat:fire', { seen: true, owned: true, bestGene: 0 });

    const call = dataOf(await board(last, 'kind=codex&limit=1'));
    expect(call.entries).toHaveLength(1);
    expect(call.selfEligible).toBe(true);
    expect(call.self?.accountId).toBe(last.accountId);
    expect(call.self?.rank).toBe(3);

    const clamp = await board(first, 'kind=codex&limit=999');
    expect(clamp.status).toBe(200);
    expect(dataOf(clamp).entries.length).toBeLessThanOrEqual(50);
  });

  it('limit 非正整数、kind 非法、赛季不匹配 → VALIDATION_FAILED', async () => {
    const a = await loginPvp(harness, 'lb-invalid-a');

    for (const query of [
      'kind=codex&limit=0',
      'kind=codex&limit=abc',
      'kind=bogus',
      'kind=codex&seasonId=s2',
    ]) {
      const call = await board(a, query);
      expect(call.status, query).toBe(400);
      expectError(call, 'VALIDATION_FAILED');
    }
  });

  it('seasonId 缺省等于当前赛季 s1', async () => {
    const a = await loginPvp(harness, 'lb-season-a');
    expect(dataOf(await board(a, 'kind=codex')).seasonId).toBe('s1');
  });
});
