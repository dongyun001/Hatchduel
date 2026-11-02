import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expectError,
  loadProfile,
  post,
  replaceProfile,
  startTestServer,
  testConfig,
  type TestHarness,
} from './helpers.js';
import {
  fight,
  fightOf,
  getOpponent,
  getReplay,
  loginPvp,
  opponentOf,
  prepareFighter,
  profileOf,
  replayOf,
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

function shanghaiDay(now: number): string {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('POST /pvp/fight：真人对战结算', () => {
  it('双方 rating/ranked/stats 按攻方结果更新，返回完整战报信息', async () => {
    const a = await newFighter('fight-real-a');
    const b = await newFighter('fight-real-b');

    const call = await fight(harness, a, b.accountId, 'fight-real-1');
    expect(call.status).toBe(200);

    const data = fightOf(call);
    expect(data.isBot).toBe(false);
    expect([0, 1, null]).toContain(data.result);
    expect(data.turns).toBeGreaterThan(0);
    expect(data.turns).toBeLessThanOrEqual(30);
    expect(data.replayId).toMatch(/^replay_/);
    expect(data.seasonId).toBe('s1');
    expect(data.opponent.accountId).toBe(b.accountId);
    expect(data.opponent.ratingAfter).toBe(
      data.opponent.ratingBefore + (data.ratingBefore - data.ratingAfter),
    );

    const attacker = await loadProfile(harness, a.accountId);
    const defender = await loadProfile(harness, b.accountId);

    expect(attacker.pvp.rating).toBe(data.ratingAfter);
    expect(defender.pvp.rating).toBe(data.opponent.ratingAfter);
    expect(attacker.pvp.ranked).toEqual({
      wins: data.result === 0 ? 1 : 0,
      losses: data.result === 1 ? 1 : 0,
      draws: data.result === null ? 1 : 0,
    });
    expect(defender.pvp.ranked).toEqual({
      wins: data.result === 1 ? 1 : 0,
      losses: data.result === 0 ? 1 : 0,
      draws: data.result === null ? 1 : 0,
    });
    expect(attacker.stats.battlesWon).toBe(data.result === 0 ? 1 : 0);
    expect(attacker.stats.battlesLost).toBe(data.result === 1 ? 1 : 0);
    expect(defender.stats.battlesWon).toBe(data.result === 1 ? 1 : 0);
    expect(defender.stats.battlesLost).toBe(data.result === 0 ? 1 : 0);
    expect(data.challengesRemaining).toBe(9);
  });

  it('机器人对局不计分、不计 ranked，只更新攻方 stats', async () => {
    const a = await newFighter('fight-bot-a');
    const opponent = opponentOf(await getOpponent(harness, a)).opponent;
    expect(opponent.isBot).toBe(true);

    const call = await fight(harness, a, opponent.accountId, 'fight-bot-1');
    expect(call.status).toBe(200);
    const data = fightOf(call);

    expect(data.isBot).toBe(true);
    expect(data.ratingBefore).toBe(1000);
    expect(data.ratingAfter).toBe(1000);
    expect(data.opponent.ratingBefore).toBe(1000);
    expect(data.opponent.ratingAfter).toBe(1000);

    const stored = await loadProfile(harness, a.accountId);
    expect(stored.pvp.rating).toBe(1000);
    expect(stored.pvp.ranked?.wins ?? 0).toBe(0);
    expect(stored.pvp.ranked?.losses ?? 0).toBe(0);
    expect(stored.pvp.ranked?.draws ?? 0).toBe(0);
    expect(stored.stats.battlesWon + stored.stats.battlesLost).toBe(data.result === null ? 0 : 1);

    const replay = await getReplay(harness, a, data.replayId);
    expect(replay.status).toBe(200);
    expect(replayOf(replay).summary.isBot).toBe(true);
  });
});

describe('POST /pvp/fight：幂等、限流与错误码', () => {
  it('同一 Idempotency-Key 重放同一结果，不重复扣次数', async () => {
    const a = await newFighter('fight-idem-a');
    const b = await newFighter('fight-idem-b');
    const revision = (await profileOf(harness, a)).revision;

    // 幂等重放必须用同一 baseRevision；否则指纹不同，按设计返回 IDEMPOTENCY_CONFLICT。
    const first = await fight(harness, a, b.accountId, 'fight-idem-key', revision);
    const second = await fight(harness, a, b.accountId, 'fight-idem-key', revision);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(fightOf(second).replayId).toBe(fightOf(first).replayId);

    const used = await harness.store.getDailyUsed(a.accountId, shanghaiDay(harness.clock.now()));
    expect(used).toBe(1);
    expect((await loadProfile(harness, b.accountId)).pvp.ranked?.losses ?? 0).toBeLessThanOrEqual(
      1,
    );
  });

  it('当日次数用完 → 429 DAILY_LIMIT_REACHED；匹配仍可用', async () => {
    await harness.close();
    harness = await startTestServer({
      pvp: { ...testConfig().pvp, dailyChallenges: 1 },
    });

    const a = await newFighter('fight-limit-a');
    const b = await newFighter('fight-limit-b');

    const first = await fight(harness, a, b.accountId, 'fight-limit-1');
    expect(first.status).toBe(200);

    const second = await fight(harness, a, b.accountId, 'fight-limit-2');
    expect(second.status).toBe(429);
    expectError(second, 'DAILY_LIMIT_REACHED');

    const match = await getOpponent(harness, a);
    expect(match.status).toBe(200);
    expect(opponentOf(match).challengesRemaining).toBe(0);
  });

  it('不能挑战自己 → OPPONENT_UNAVAILABLE', async () => {
    const a = await newFighter('fight-self');
    const call = await fight(harness, a, a.accountId, 'fight-self-1');
    expect(call.status).toBe(409);
    expectError(call, 'OPPONENT_UNAVAILABLE');
  });

  it('对手没有防守快照 → OPPONENT_UNAVAILABLE', async () => {
    const a = await newFighter('fight-nodef-a');
    const b = await loginPvp(harness, 'fight-nodef-b');

    const call = await fight(harness, a, b.accountId, 'fight-nodef-1');
    expect(call.status).toBe(409);
    expectError(call, 'OPPONENT_UNAVAILABLE');
  });

  it('baseRevision 过期 → 409 REVISION_CONFLICT', async () => {
    const a = await newFighter('fight-rev-a');
    const b = await newFighter('fight-rev-b');
    const stale = (await profileOf(harness, a)).revision + 3;

    const call = await fight(harness, a, b.accountId, 'fight-rev-1', stale);
    expect(call.status).toBe(409);
    expectError(call, 'REVISION_CONFLICT');
  });

  it('客户端提交 seed/result 一律忽略，seed 仍由服务器生成', async () => {
    const a = await newFighter('fight-cheat');
    const opponent = opponentOf(await getOpponent(harness, a)).opponent;
    const revision = (await profileOf(harness, a)).revision;

    const call = await post(
      harness,
      '/pvp/fight',
      {
        opponentAccountId: opponent.accountId,
        seed: -12345,
        winner: 0,
        result: 0,
      },
      {
        authorization: `Bearer ${a.token}`,
        'idempotency-key': 'fight-cheat-1',
        'x-base-revision': String(revision),
      },
    );
    expect(call.status).toBe(200);

    const replay = replayOf(await getReplay(harness, a, fightOf(call).replayId));
    expect(replay.replay.seed).toBeGreaterThan(0);
    expect(replay.replay.seed).not.toBe(-12345);
  });
});

describe('GET /pvp/replay/:id', () => {
  it('攻守双方可读，第三人 FORBIDDEN，不存在 NOT_FOUND', async () => {
    const a = await newFighter('replay-a');
    const b = await newFighter('replay-b');
    const c = await newFighter('replay-c');
    const data = fightOf(await fight(harness, a, b.accountId, 'replay-fight-1'));

    expect((await getReplay(harness, a, data.replayId)).status).toBe(200);
    expect((await getReplay(harness, b, data.replayId)).status).toBe(200);

    const forbidden = await getReplay(harness, c, data.replayId);
    expect(forbidden.status).toBe(403);
    expectError(forbidden, 'FORBIDDEN');

    const missing = await getReplay(harness, a, 'replay_missing');
    expect(missing.status).toBe(404);
    expectError(missing, 'NOT_FOUND');
  });

  it('超过保留期 → 410 REPLAY_EXPIRED', async () => {
    await harness.close();
    harness = await startTestServer({
      pvp: { ...testConfig().pvp, replayTtlMs: 1000 },
    });

    const a = await newFighter('replay-exp-a');
    const b = await newFighter('replay-exp-b');
    const data = fightOf(await fight(harness, a, b.accountId, 'replay-exp-1'));

    harness.clock.advance(2000);
    const call = await getReplay(harness, a, data.replayId);
    expect(call.status).toBe(410);
    expectError(call, 'REPLAY_EXPIRED');
  });

  it('回放以已存 events 为准；后续改宠物等级不回溯旧战报', async () => {
    const a = await newFighter('replay-stable-a');
    const b = await newFighter('replay-stable-b');
    const data = fightOf(await fight(harness, a, b.accountId, 'replay-stable-1'));

    const before = replayOf(await getReplay(harness, a, data.replayId));

    await replaceProfile(harness, b.accountId, (profile) => ({
      ...profile,
      pets: Object.fromEntries(
        Object.entries(profile.pets).map(([id, pet]) => [id, { ...pet, level: 20 }]),
      ),
    }));

    const after = replayOf(await getReplay(harness, a, data.replayId));
    expect(after.replay.events).toEqual(before.replay.events);
    expect(after.replay.commands).toEqual(before.replay.commands);
    expect(after.summary).toEqual(before.summary);
    expect(after.replay.setup).toEqual(before.replay.setup);
  });
});
