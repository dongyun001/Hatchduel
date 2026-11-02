import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup } from '@petbattle/core';

import {
  expectError,
  replaceProfile,
  startTestServer,
  testConfig,
  type TestHarness,
} from './helpers.js';
import {
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

async function newFighter(deviceId: string): Promise<PvpAccount> {
  const account = await loginPvp(harness, deviceId);
  await prepareFighter(harness, account, deviceId);
  return account;
}

async function setRating(account: PvpAccount, rating: number): Promise<void> {
  await replaceProfile(harness, account.accountId, (profile) => ({
    ...profile,
    pvp: { ...profile.pvp, rating, seasonId: 's1' },
  }));
}

async function setPetLevels(account: PvpAccount, level: number): Promise<void> {
  await replaceProfile(harness, account.accountId, (profile) => ({
    ...profile,
    pvp: { ...profile.pvp, seasonId: 's1' },
    pets: Object.fromEntries(
      Object.entries(profile.pets).map(([id, pet]) => [id, { ...pet, level }]),
    ),
  }));
}

const EMPTY_SETUP: BattleSetup = { seed: 1, teams: [[], []] };

/** 直接写一条战报，模拟“最近 24h 打过”。 */
async function seedReplay(
  attacker: PvpAccount,
  defender: PvpAccount,
  createdAt: number,
): Promise<void> {
  await harness.store.createPvpReplay({
    replayId: `replay_${attacker.accountId}_${defender.accountId}`,
    attackerId: attacker.accountId,
    defenderId: defender.accountId,
    isBot: false,
    seasonId: 's1',
    contentVersion: 'test',
    setup: EMPTY_SETUP,
    seed: 1,
    commands: [],
    events: [],
    winner: null,
    turns: 1,
    attackerRatingBefore: 1000,
    attackerRatingAfter: 1000,
    defenderRatingBefore: 1000,
    defenderRatingAfter: 1000,
    createdAt,
    expiresAt: createdAt + 30 * 24 * 60 * 60 * 1000,
  });
}

async function seedRating(account: PvpAccount, rating: number): Promise<void> {
  await setRating(account, rating);
}

describe('GET /pvp/opponent：候选与机器人', () => {
  it('只有自己的防守 → 机器人兜底', async () => {
    const a = await newFighter('match-bot-a');
    const call = await getOpponent(harness, a);
    expect(call.status).toBe(200);

    const data = opponentOf(call);
    expect(data.opponent.isBot).toBe(true);
    expect(data.opponent.rating).toBe(1000);
    expect(data.opponent.petCount).toBe(3);
    expect(data.opponent.speciesPreview).toHaveLength(3);
    expect(data.opponent.avgLevel).toBeGreaterThanOrEqual(1);
    expect(data.opponent.avgLevel).toBeLessThanOrEqual(20);
    expect(data.dailyLimit).toBe(10);
    expect(data.challengesRemaining).toBe(10);
    expect(data.seasonId).toBe('s1');
  });

  it('两个账号互不匹配自己，只匹配对方', async () => {
    const a = await newFighter('match-peer-a');
    const b = await newFighter('match-peer-b');

    const forA = await getOpponent(harness, a);
    const forB = await getOpponent(harness, b);

    expect(opponentOf(forA).opponent.accountId).toBe(b.accountId);
    expect(opponentOf(forB).opponent.accountId).toBe(a.accountId);
    expect(opponentOf(forA).opponent.isBot).toBe(false);
    expect(opponentOf(forA).opponent.speciesPreview).toHaveLength(3);
  });

  it('匹配不消耗挑战次数', async () => {
    const a = await newFighter('match-free-a');
    await getOpponent(harness, a);
    await getOpponent(harness, a);
    const used = await harness.store.getDailyUsed(a.accountId, shanghaiDay(harness.clock.now()));
    expect(used).toBe(0);
  });

  it('机器人禁用且无候选 → OPPONENT_UNAVAILABLE', async () => {
    await harness.close();
    harness = await startTestServer({
      pvp: { ...testConfig().pvp, botsEnabled: false },
    });

    const a = await newFighter('match-no-bot');
    const call = await getOpponent(harness, a);
    expect(call.status).toBe(409);
    expectError(call, 'OPPONENT_UNAVAILABLE');
  });
});

describe('GET /pvp/opponent：窗口与排序', () => {
  it('200 窗口内按 rating 差升序选最近者', async () => {
    const attacker = await newFighter('match-win-attacker');
    const near = await newFighter('match-win-near');
    const mid = await newFighter('match-win-mid');
    const far = await newFighter('match-win-far');

    await seedRating(attacker, 1000);
    await seedRating(near, 1010);
    await seedRating(mid, 1100);
    await seedRating(far, 1500);

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).toBe(near.accountId);
  });

  it('200 为空时退到 600 窗口，仍排除 600 外', async () => {
    const attacker = await newFighter('match-600-attacker');
    const inside = await newFighter('match-600-inside');
    const outside = await newFighter('match-600-outside');

    await seedRating(attacker, 1000);
    await seedRating(inside, 1300);
    await seedRating(outside, 1700);

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).toBe(inside.accountId);
  });

  it('200/600 都为空时退到不限窗口', async () => {
    const attacker = await newFighter('match-inf-attacker');
    const closer = await newFighter('match-inf-closer');
    const farther = await newFighter('match-inf-farther');

    await seedRating(attacker, 1000);
    await seedRating(closer, 1700);
    await seedRating(farther, 2000);

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).toBe(closer.accountId);
  });

  it('rating 差相同时按平均等级差、再按 accountId 稳定排序', async () => {
    const attacker = await newFighter('match-level-attacker');
    const low = await newFighter('match-level-low');
    const high = await newFighter('match-level-high');

    await setPetLevels(attacker, 1);
    await setPetLevels(low, 5);
    await setPetLevels(high, 12);
    await seedRating(attacker, 1000);
    await seedRating(low, 1000);
    await seedRating(high, 1000);

    // 快照在改等级之后重建，确保 avgLevel 生效。
    await prepareFighter(harness, attacker, 'match-level-attacker-2');
    await prepareFighter(harness, low, 'match-level-low-2');
    await prepareFighter(harness, high, 'match-level-high-2');

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).toBe(low.accountId);
    expect(opponentOf(call).opponent.avgLevel).toBeCloseTo(5, 5);
  });

  it('rating/平均等级都相同时按 accountId 升序稳定选择', async () => {
    const attacker = await newFighter('match-id-attacker');
    const b = await newFighter('match-id-b');
    const c = await newFighter('match-id-c');

    await seedRating(attacker, 1000);
    await seedRating(b, 1000);
    await seedRating(c, 1000);

    const expected = [b.accountId, c.accountId].sort()[0];
    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).toBe(expected);
  });

  it('候选 ≥3 时排除最近 24h 打过的对手', async () => {
    const attacker = await newFighter('match-recent-attacker');
    const recent = await newFighter('match-recent-b');
    const other1 = await newFighter('match-recent-c');
    const other2 = await newFighter('match-recent-d');

    await seedRating(attacker, 1000);
    await seedRating(recent, 1000);
    await seedRating(other1, 1005);
    await seedRating(other2, 1006);
    await seedReplay(attacker, recent, harness.clock.now() - 60 * 60 * 1000);

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.accountId).not.toBe(recent.accountId);
  });

  it('排除后为空则忽略排除，仍选真人', async () => {
    const attacker = await newFighter('match-ignore-attacker');
    const b = await newFighter('match-ignore-b');
    const c = await newFighter('match-ignore-c');
    const d = await newFighter('match-ignore-d');

    await seedRating(attacker, 1000);
    for (const candidate of [b, c, d]) {
      await seedRating(candidate, 1000);
      await seedReplay(attacker, candidate, harness.clock.now() - 60 * 60 * 1000);
    }

    const call = await getOpponent(harness, attacker);
    expect(opponentOf(call).opponent.isBot).toBe(false);
    expect([b.accountId, c.accountId, d.accountId]).toContain(opponentOf(call).opponent.accountId);
  });
});

/** 与 pvp-rules 相同的上海日期算法；测试独立实现，避免“用被测代码验证自己”。 */
function shanghaiDay(now: number): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
