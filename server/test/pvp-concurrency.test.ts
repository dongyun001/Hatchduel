import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProfile, startTestServer, type TestHarness } from './helpers.js';
import { fight, fightOf, loginPvp, prepareFighter, type PvpAccount } from './pvp-helpers.js';

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

describe('PvP 并发', () => {
  it('同一防守方同时被两人挑战：rating/ranked/stats 不丢更新（P-105）', async () => {
    const defender = await newFighter('concurrent-defender');
    const attackerA = await newFighter('concurrent-attacker-a');
    const attackerB = await newFighter('concurrent-attacker-b');

    const [first, second] = await Promise.all([
      fight(harness, attackerA, defender.accountId, 'concurrent-a-1'),
      fight(harness, attackerB, defender.accountId, 'concurrent-b-1'),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fightOf(first).replayId).not.toBe(fightOf(second).replayId);

    const stored = await loadProfile(harness, defender.accountId);
    const ranked = stored.pvp.ranked;
    expect((ranked?.wins ?? 0) + (ranked?.losses ?? 0) + (ranked?.draws ?? 0)).toBe(2);
    expect(stored.stats.battlesWon + stored.stats.battlesLost).toBe(
      (ranked?.wins ?? 0) + (ranked?.losses ?? 0),
    );

    // 两次结算都落库：revision 至少 +2（具体增量取决于各自写路径）。
    expect(stored.revision).toBeGreaterThanOrEqual(4);
    expect(stored.pvp.rating).toBeGreaterThanOrEqual(0);
  });
});
