import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPet } from '@petbattle/core';
import type { ConfigRepo, PetInstance } from '@petbattle/core';

import { testConfigRepo } from './fixtures.js';
import {
  expectError,
  loadProfile,
  post,
  replaceProfile,
  startTestServer,
  type TestHarness,
} from './helpers.js';
import {
  defenseOf,
  getDefense,
  loginPvp,
  prepareFighter,
  profileOf,
  setDefense,
  writeHeaders,
  type PvpAccount,
} from './pvp-helpers.js';

let harness: TestHarness;
let cfg: ConfigRepo;
let account: PvpAccount;

beforeEach(async () => {
  // stale 用例要跨 25h；access token 默认只有 2h，这里放宽避免测试被鉴权拦截。
  harness = await startTestServer({ accessTokenTtlMs: 72 * 60 * 60 * 1000 });
  cfg = await testConfigRepo();
  account = await loginPvp(harness, 'device-pvp-defense');
});

afterEach(async () => {
  await harness.close();
});

async function addEgg(): Promise<string> {
  const now = harness.clock.now();
  const egg = createPet(
    {
      id: 'pet_test_egg',
      speciesId: 'turtle',
      elementId: 'water',
      genome: {
        stats: { hp: 50, atk: 50, def: 50, spd: 50 },
        speciesAlleles: ['turtle', 'turtle'],
        elementAlleles: ['water', 'water'],
        traitAlleles: [],
        mutationCount: 0,
      },
      gender: 'male',
      generation: 1,
      parents: [null, null],
      now,
    },
    cfg,
  );
  await replaceProfile(harness, account.accountId, (current) => ({
    ...current,
    pets: { ...current.pets, [egg.id]: egg as PetInstance },
  }));
  return egg.id;
}

describe('POST /pvp/defense', () => {
  it('设置成功：写快照 + profile.pvp.defense，返回 patch 与 revision', async () => {
    const profile = await profileOf(harness, account);
    const petIds = Object.values(profile.pets)
      .map((pet) => pet.id)
      .slice(0, 3);

    const call = await setDefense(harness, account, petIds, 'def-1');
    expect(call.status).toBe(200);
    const data = call.body.data as { patch: { pvp?: { defense: string[] } }; revision: number };
    expect(data.patch.pvp?.defense).toEqual(petIds);
    expect(data.revision).toBe(1);

    const stored = await loadProfile(harness, account.accountId);
    expect(stored.pvp.defense).toEqual(petIds);
    expect(stored.pvp.seasonId).toBe('s1');

    const snapshot = await harness.store.getPvpDefense(account.accountId);
    expect(snapshot?.petIds).toEqual(petIds);
    expect(snapshot?.units.map((unit) => unit.uid)).toEqual(['d0', 'd1', 'd2']);
  });

  it('重复设置直接替换旧快照', async () => {
    const first = await prepareFighter(harness, account, 'first');
    const profile = await profileOf(harness, account);
    const other = Object.values(profile.pets)
      .map((pet) => pet.id)
      .slice(0, 1);

    const call = await setDefense(harness, account, other, 'def-replace');
    expect(call.status).toBe(200);

    const snapshot = await harness.store.getPvpDefense(account.accountId);
    expect(snapshot?.petIds).toEqual(other);
    expect(snapshot?.petIds).not.toEqual(first.petIds);
  });

  it('数量超过 3 只 → INVALID_LINEUP', async () => {
    await replaceProfile(harness, account.accountId, (profile) => {
      const extra = Object.values(profile.pets)[0];
      if (extra === undefined) throw new Error('缺少宠物');
      return {
        ...profile,
        pets: {
          ...profile.pets,
          pet_extra: { ...extra, id: 'pet_extra' },
        },
      };
    });
    const profile = await profileOf(harness, account);
    const petIds = Object.values(profile.pets)
      .map((pet) => pet.id)
      .slice(0, 4);

    const call = await setDefense(harness, account, petIds, 'def-too-many');
    expect(call.status).toBe(400);
    expectError(call, 'INVALID_LINEUP');
  });

  it('重复宠物 → INVALID_LINEUP', async () => {
    const profile = await profileOf(harness, account);
    const petId = Object.keys(profile.pets)[0] as string;

    const call = await setDefense(harness, account, [petId, petId], 'def-dup');
    expect(call.status).toBe(400);
    expectError(call, 'INVALID_LINEUP');
  });

  it('不存在的宠物 → INVALID_LINEUP', async () => {
    const call = await setDefense(harness, account, ['pet_missing'], 'def-missing');
    expect(call.status).toBe(400);
    expectError(call, 'INVALID_LINEUP');
  });

  it('蛋不能进防守 → INVALID_LINEUP', async () => {
    const eggId = await addEgg();
    const call = await setDefense(harness, account, [eggId], 'def-egg');
    expect(call.status).toBe(400);
    expectError(call, 'INVALID_LINEUP');
  });

  it('petIds 不是数组 → VALIDATION_FAILED', async () => {
    const profile = await profileOf(harness, account);
    const call = await post(
      harness,
      '/pvp/defense',
      { petIds: 'abc' },
      writeHeaders(account, 'def-bad-shape', profile.revision),
    );
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('baseRevision 过期 → 409 + 最新快照', async () => {
    const profile = await profileOf(harness, account);
    const petIds = Object.values(profile.pets)
      .map((pet) => pet.id)
      .slice(0, 1);
    const call = await post(
      harness,
      '/pvp/defense',
      { petIds },
      writeHeaders(account, 'def-stale-rev', profile.revision + 5),
    );
    expect(call.status).toBe(409);
    expectError(call, 'REVISION_CONFLICT');
    const details = call.body.error?.details as { latestRevision: number };
    expect(details.latestRevision).toBe(profile.revision);
  });

  it('同一幂等键重放返回首次结果，不重复推进 revision', async () => {
    const profile = await profileOf(harness, account);
    const petIds = Object.values(profile.pets)
      .map((pet) => pet.id)
      .slice(0, 2);

    // 幂等重放必须用同一 baseRevision；否则指纹不同，按设计返回 IDEMPOTENCY_CONFLICT。
    const first = await setDefense(harness, account, petIds, 'def-idem', profile.revision);
    const second = await setDefense(harness, account, petIds, 'def-idem', profile.revision);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect((await loadProfile(harness, account.accountId)).revision).toBe(1);
  });
});

describe('GET /pvp/defense', () => {
  it('未设置返回 200 且 defense 缺省', async () => {
    const call = await getDefense(harness, account);
    expect(call.status).toBe(200);
    expect(defenseOf(call).defense).toBeUndefined();
  });

  it('已设置返回 petIds/createdAt/expiresAt/stale=false', async () => {
    const { petIds } = await prepareFighter(harness, account, 'get');
    const call = await getDefense(harness, account);
    expect(call.status).toBe(200);
    const data = defenseOf(call);
    expect(data.defense?.petIds).toEqual(petIds);
    expect(data.defense?.stale).toBe(false);
    expect(data.defense?.expiresAt).toBeGreaterThan(data.defense?.createdAt ?? 0);
  });

  it('超过 24h 返回 stale=true，但快照仍可读取', async () => {
    const { petIds } = await prepareFighter(harness, account, 'stale');
    harness.clock.advance(25 * 60 * 60 * 1000);

    const call = await getDefense(harness, account);
    expect(call.status).toBe(200);
    expect(defenseOf(call).defense?.stale).toBe(true);
    expect(defenseOf(call).defense?.petIds).toEqual(petIds);
  });
});
