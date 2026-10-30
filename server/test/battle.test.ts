import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BattleSetup, ConfigRepo, Profile, StageConfig } from '@petbattle/core';
import type {
  ClaimPveBattleResponse,
  GetProfileResponse,
  StartPveBattleResponse,
} from '@petbattle/protocol';

import {
  drawingSetup,
  losingSetup,
  playToCommands,
  setupOf,
  unit,
  winningSetup,
} from './battle-fixtures.js';
import { testConfigRepo } from './fixtures.js';
import {
  authHeaders,
  expectError,
  get,
  guestLogin,
  loadProfile,
  post,
  replaceProfile,
  startTestServer,
  type HttpCall,
  type TestHarness,
} from './helpers.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

let harness: TestHarness;
let cfg: ConfigRepo;
let accountId: string;
let token: string;

beforeEach(async () => {
  harness = await startTestServer();
  cfg = await testConfigRepo();
  const login = await guestLogin(harness, 'device-battle');
  accountId = login.data.account.id;
  token = login.data.token;
});

afterEach(async () => {
  await harness.close();
});

async function revision(): Promise<number> {
  return (await loadProfile(harness, accountId)).revision;
}

async function readProfile(): Promise<Profile> {
  const call = await get(harness, '/profile', authHeaders(token));
  expect(call.status).toBe(200);
  return (call.body.data as GetProfileResponse).profile;
}

async function setLineup(petIds: string[], baseRevision: number, key: string): Promise<HttpCall> {
  return post(harness, '/lineup/set', { petIds }, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

function start(extraBody: Record<string, unknown>, key: string, baseRevision: number): Promise<HttpCall> {
  return post(harness, '/battle/pve/start', extraBody, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

function claim(
  battleId: string,
  commands: unknown,
  key: string,
  baseRevision: number,
  extraBody: Record<string, unknown> = {},
): Promise<HttpCall> {
  return post(harness, '/battle/pve/claim', { battleId, commands, ...extraBody }, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

/** 直接用存储写入一个可控会话（claim 只认会话里的 setup 快照）。 */
async function seedSession(
  setup: BattleSetup,
  options: { stageId?: string; battleId?: string; expiresAt?: number } = {},
): Promise<string> {
  const battleId = options.battleId ?? `battle_test_${randomUUID()}`;
  const now = harness.clock.now();
  await harness.store.createBattleSession({
    battleId,
    accountId,
    stageId: options.stageId ?? 'stage_1',
    seed: setup.seed,
    setup,
    partyPetIds: [],
    createdAt: now,
    expiresAt: options.expiresAt ?? now + SESSION_TTL_MS,
    status: 'started',
  });
  return battleId;
}

function stageById(stageId: string): StageConfig {
  const stage = cfg.allStages().find((entry) => entry.id === stageId);
  if (stage === undefined) throw new Error(`缺少关卡配置 ${stageId}`);
  return stage;
}

describe('POST /battle/pve/start', () => {
  it('成功开战：返回 battleId/setup/expiresAt，seed 由服务器生成', async () => {
    const profile = await readProfile();
    const lineup = profile.lineup.length > 0 ? profile.lineup : Object.keys(profile.pets).slice(0, 3);
    if (profile.lineup.length === 0) {
      const assigned = await setLineup(lineup, profile.revision, 'battle-lineup');
      expect(assigned.status).toBe(200);
    }

    const base = await revision();
    // 客户端塞 seed / winner 也应被忽略。
    const response = await start(
      { stageId: 'stage_1', seed: 1, winner: 0 },
      'battle-start-1',
      base,
    );
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(base);

    const data = response.body.data as StartPveBattleResponse;
    expect(data.battleId.startsWith('battle_')).toBe(true);
    expect(data.stageId).toBe('stage_1');
    expect(data.expiresAt).toBe(harness.clock.now() + SESSION_TTL_MS);
    expect(data.setup.teams[0]).toHaveLength(lineup.length);
    expect(data.setup.teams[1]).toHaveLength(stageById('stage_1').enemies.length);

    const session = await harness.store.getBattleSession(data.battleId);
    expect(session?.partyPetIds).toEqual(lineup);
    expect(session?.status).toBe('started');
    expect(session?.seed).toBe(data.setup.seed);
    expect(data.setup.seed).not.toBe(1);
  });

  it('关卡未解锁返回 STAGE_LOCKED', async () => {
    const profile = await readProfile();
    await setLineup(Object.keys(profile.pets), profile.revision, 'battle-lineup-2');

    const base = await revision();
    const response = await start({ stageId: 'stage_2' }, 'battle-locked', base);
    expect(response.status).toBe(403);
    expectError(response, 'STAGE_LOCKED');
  });

  it('编队为空 / 含蛋 返回 INVALID_LINEUP', async () => {
    const base = await revision();
    const empty = await start({ stageId: 'stage_1' }, 'battle-empty-lineup', base);
    expect(empty.status).toBe(400);
    expectError(empty, 'INVALID_LINEUP');

    // 编队里有蛋（直接把某只改成蛋并放进编队）。
    const profile = await readProfile();
    const petId = Object.keys(profile.pets)[0];
    if (petId === undefined) throw new Error('初始档缺少宠物');
    const now = harness.clock.now();
    await replaceProfile(harness, accountId, (current) => {
      const pet = current.pets[petId];
      if (pet === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        lineup: [petId],
        pets: {
          ...current.pets,
          [petId]: { ...pet, stage: 'egg', bornAt: now, stageChangedAt: now, updatedAt: now },
        },
      };
    });

    const egg = await start({ stageId: 'stage_1' }, 'battle-egg-lineup', await revision());
    expect(egg.status).toBe(400);
    expectError(egg, 'INVALID_LINEUP');
  });

  it('再次 start 会让旧会话失效（BATTLE_EXPIRED）', async () => {
    const profile = await readProfile();
    await setLineup(Object.keys(profile.pets).slice(0, 2), profile.revision, 'battle-lineup-3');

    const first = await start({ stageId: 'stage_1' }, 'battle-first', await revision());
    const firstData = first.body.data as StartPveBattleResponse;
    const commands = playToCommands(firstData.setup, cfg);

    const secondBase = await revision();
    const second = await start({ stageId: 'stage_1' }, 'battle-second', secondBase);
    expect(second.status).toBe(200);

    const stale = await claim(
      firstData.battleId,
      commands,
      'battle-stale-claim',
      secondBase,
    );
    expect(stale.status).toBe(409);
    expectError(stale, 'BATTLE_EXPIRED');
  });

  it('未登录 401；缺幂等键 / baseRevision 400', async () => {
    const unauthenticated = await post(
      harness,
      '/battle/pve/start',
      { stageId: 'stage_1' },
      { 'idempotency-key': 'k', 'x-base-revision': '0' },
    );
    expect(unauthenticated.status).toBe(401);

    const noKey = await post(harness, '/battle/pve/start', { stageId: 'stage_1' }, {
      ...authHeaders(token),
      'x-base-revision': '0',
    });
    expect(noKey.status).toBe(400);
    expectError(noKey, 'VALIDATION_FAILED');

    const noRevision = await post(harness, '/battle/pve/start', { stageId: 'stage_1' }, {
      ...authHeaders(token),
      'idempotency-key': 'no-rev',
    });
    expect(noRevision.status).toBe(400);
    expectError(noRevision, 'VALIDATION_FAILED');
  });

  it('过期 baseRevision 返回 409 + 最新快照', async () => {
    const profile = await readProfile();
    await setLineup(Object.keys(profile.pets), profile.revision, 'battle-lineup-4');

    const response = await start({ stageId: 'stage_1' }, 'battle-stale-start', 0);
    expect(response.status).toBe(409);
    expectError(response, 'REVISION_CONFLICT');
  });
});

describe('POST /battle/pve/claim', () => {
  it('真实开战 → 指令重放 → 发奖；同键重放一致，新键 ALREADY_CLAIMED', async () => {
    const profile = await readProfile();
    await setLineup(Object.keys(profile.pets).slice(0, 3), profile.revision, 'claim-lineup');

    const startResponse = await start({ stageId: 'stage_1' }, 'claim-start', await revision());
    const started = startResponse.body.data as StartPveBattleResponse;
    const commands = playToCommands(started.setup, cfg);

    const base = await revision();
    const claimed = await claim(started.battleId, commands, 'claim-1', base);
    expect(claimed.status).toBe(200);
    expect(claimed.body.revision).toBe(base + 1);

    const data = claimed.body.data as ClaimPveBattleResponse;
    const expectedWinner = data.winner;
    expect([0, 1, null]).toContain(expectedWinner);
    expect(data.rewards.firstClear).toBe(expectedWinner === 0);

    const stored = await readProfile();
    if (expectedWinner === 0) {
      expect(stored.stageProgress['stage_1']?.cleared).toBe(true);
      expect(stored.stats.battlesWon).toBe(1);
      expect(data.rewards.resources).toBeDefined();
    } else {
      expect(stored.stageProgress['stage_1']?.cleared).toBeUndefined();
      expect(stored.stats.battlesLost).toBe(1);
      expect(data.rewards.resources).toBeUndefined();
    }

    // 同键重放：完全一致，不重复发奖。
    const replay = await claim(started.battleId, commands, 'claim-1', base);
    expect(replay.body).toEqual(claimed.body);

    // 新键重复领取：ALREADY_CLAIMED。
    const again = await claim(started.battleId, commands, 'claim-2', base + 1);
    expect(again.status).toBe(409);
    expectError(again, 'ALREADY_CLAIMED');
  });

  it('胜利首通发奖；重复胜利走 repeat 档', async () => {
    const winSetup = winningSetup();
    const commands = playToCommands(winSetup, cfg);
    const stage = stageById('stage_1');

    const first = await seedSession(winSetup);
    const firstResponse = await claim(first, commands, 'win-first', await revision());
    expect(firstResponse.status).toBe(200);
    const firstData = firstResponse.body.data as ClaimPveBattleResponse;
    expect(firstData.winner).toBe(0);
    expect(firstData.rewards.firstClear).toBe(true);
    expect(firstData.rewards.resources).toEqual(stage.rewards.firstClear?.resources);

    const afterFirst = await readProfile();
    expect(afterFirst.stageProgress['stage_1']?.cleared).toBe(true);
    expect(afterFirst.stageProgress['stage_1']?.firstClearAt).toBe(harness.clock.now());
    expect(afterFirst.stats.battlesWon).toBe(1);

    const second = await seedSession(winSetup);
    const secondResponse = await claim(second, commands, 'win-repeat', await revision());
    const secondData = secondResponse.body.data as ClaimPveBattleResponse;
    expect(secondData.winner).toBe(0);
    expect(secondData.rewards.firstClear).toBe(false);
    expect(secondData.rewards.resources).toEqual(stage.rewards.repeat?.resources);

    const afterSecond = await readProfile();
    expect(afterSecond.stats.battlesWon).toBe(2);
  });

  it('失败不发奖，只记 battlesLost', async () => {
    const loseSetup = losingSetup();
    const commands = playToCommands(loseSetup, cfg);

    const battleId = await seedSession(loseSetup);
    const response = await claim(battleId, commands, 'lose-1', await revision());
    expect(response.status).toBe(200);

    const data = response.body.data as ClaimPveBattleResponse;
    expect(data.winner).toBe(1);
    expect(data.rewards.firstClear).toBe(false);
    expect(data.rewards.resources).toBeUndefined();

    const stored = await readProfile();
    expect(stored.stats.battlesLost).toBe(1);
    expect(stored.stats.battlesWon).toBe(0);
    expect(stored.stageProgress['stage_1']).toBeUndefined();

    // E-06a：敌方图鉴“见过”在失败时也要标记（打过即见过），但不拥有。
    for (const enemy of stageById('stage_1').enemies) {
      const key = `${enemy.speciesId}:${enemy.elementId}` as keyof typeof stored.codex;
      expect(stored.codex[key]?.seen).toBe(true);
      expect(stored.codex[key]?.owned).toBe(false);
    }
  });

  it('平局按失败计：不发奖、battlesLost +1', async () => {
    const drawSetup = drawingSetup();
    const commands = playToCommands(drawSetup, cfg);

    const battleId = await seedSession(drawSetup);
    const response = await claim(battleId, commands, 'draw-1', await revision());
    expect(response.status).toBe(200);

    const data = response.body.data as ClaimPveBattleResponse;
    expect(data.winner).toBeNull();
    expect(data.rewards.firstClear).toBe(false);
    expect(data.rewards.resources).toBeUndefined();

    const stored = await readProfile();
    expect(stored.stats.battlesLost).toBe(1);
    expect(stored.stats.battlesWon).toBe(0);
  });

  it('结束后多余的指令被忽略（E-02a），不当作弊', async () => {
    const winSetup = winningSetup();
    const battleId = await seedSession(winSetup);
    const commands = playToCommands(winSetup, cfg);
    const withExtra = [...commands, { type: 'surrender', turn: 99, uid: 'b0' }];

    const response = await claim(battleId, withExtra, 'extra-commands', await revision());
    expect(response.status).toBe(200);
    expect((response.body.data as ClaimPveBattleResponse).winner).toBe(0);
  });

  it('客户端提交的 winner 被忽略，以重放结果为准', async () => {
    const loseSetup = losingSetup();
    const commands = playToCommands(loseSetup, cfg);
    const battleId = await seedSession(loseSetup);

    const response = await claim(battleId, commands, 'ignore-winner', await revision(), {
      winner: 0,
      rewards: { firstClear: true },
    });
    expect(response.status).toBe(200);
    const data = response.body.data as ClaimPveBattleResponse;
    expect(data.winner).toBe(1);
    expect(data.rewards.firstClear).toBe(false);
  });

  it('指令非法 / 未打完 / 空数组 都返回 VALIDATION_FAILED', async () => {
    // 两个敌人：至少两条指令才能打完，方便构造“指令用尽但未结束”。
    const multi = setupOf(
      [unit('a0', { hp: 1000, atk: 1000, spd: 100 })],
      [unit('b0', { hp: 1 }), unit('b1', { hp: 1 })],
    );
    const battleId = await seedSession(multi);
    const valid = playToCommands(multi, cfg);

    const empty = await claim(battleId, [], 'bad-empty', await revision());
    expect(empty.status).toBe(400);
    expectError(empty, 'VALIDATION_FAILED');

    const notArray = await claim(battleId, 'nope', 'bad-type', await revision());
    expect(notArray.status).toBe(400);
    expectError(notArray, 'VALIDATION_FAILED');

    const truncated = await claim(battleId, valid.slice(0, 1), 'bad-unfinished', await revision());
    expect(truncated.status).toBe(400);
    expectError(truncated, 'VALIDATION_FAILED');

    const wrongTurn = valid.map((command) => ({ ...command, turn: 99 }));
    const invalid = await claim(battleId, wrongTurn, 'bad-command', await revision());
    expect(invalid.status).toBe(400);
    expectError(invalid, 'VALIDATION_FAILED');
  });

  it('会话不存在 / 属于他人 / 过期', async () => {
    const missing = await claim('battle_missing', [], 'missing', await revision());
    expect(missing.status).toBe(404);
    expectError(missing, 'BATTLE_NOT_FOUND');

    const other = await guestLogin(harness, 'device-battle-other', 'other-login');
    const otherToken = other.data.token;
    const battleId = await seedSession(winningSetup());
    const foreign = await post(harness, '/battle/pve/claim', { battleId, commands: [] }, {
      ...authHeaders(otherToken),
      'idempotency-key': 'foreign',
      'x-base-revision': '0',
    });
    expect(foreign.status).toBe(404);
    expectError(foreign, 'BATTLE_NOT_FOUND');

    const expiredId = await seedSession(winningSetup(), {
      expiresAt: harness.clock.now() + 1000,
    });
    harness.clock.advance(2000);
    const expired = await claim(expiredId, playToCommands(winningSetup(), cfg), 'expired', await revision());
    expect(expired.status).toBe(409);
    expectError(expired, 'BATTLE_EXPIRED');
  });

  it('过期 baseRevision 返回 409', async () => {
    const winSetup = winningSetup();
    const battleId = await seedSession(winSetup);
    const commands = playToCommands(winSetup, cfg);

    // 先制造一次写操作把 revision 推高，再用 0 去 claim。
    const profile = await readProfile();
    const petId = Object.keys(profile.pets)[0];
    if (petId === undefined) throw new Error('初始档缺少宠物');
    const renamed = await post(harness, `/pets/${petId}/rename`, { name: '改名' }, {
      ...authHeaders(token),
      'idempotency-key': 'stale-prep',
      'x-base-revision': String(profile.revision),
    });
    expect(renamed.status).toBe(200);

    const response = await claim(battleId, commands, 'stale-claim', 0);
    expect(response.status).toBe(409);
    expectError(response, 'REVISION_CONFLICT');
  });
});
