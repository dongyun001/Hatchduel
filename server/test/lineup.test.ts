import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PetInstance, Profile } from '@petbattle/core';
import type { GetProfileResponse, ProfileWriteResponse } from '@petbattle/protocol';

import {
  authHeaders,
  expectError,
  get,
  guestLogin,
  post,
  replaceProfile,
  startTestServer,
  type HttpCall,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let accountId: string;
let token: string;

beforeEach(async () => {
  harness = await startTestServer();
  const login = await guestLogin(harness, 'device-lineup');
  accountId = login.data.account.id;
  token = login.data.token;
});

afterEach(async () => {
  await harness.close();
});

async function readProfile(): Promise<Profile> {
  const call = await get(harness, '/profile', authHeaders(token));
  expect(call.status).toBe(200);
  return (call.body.data as GetProfileResponse).profile;
}

async function petIds(): Promise<string[]> {
  const profile = await readProfile();
  return Object.keys(profile.pets);
}

function setLineup(petIdsValue: unknown, key: string, baseRevision: number): Promise<HttpCall> {
  return post(
    harness,
    '/lineup/set',
    { petIds: petIdsValue },
    {
      ...authHeaders(token),
      'idempotency-key': key,
      'x-base-revision': String(baseRevision),
    },
  );
}

/**
 * 把宠物改成"刚出生的蛋"：stage 由 bornAt 推导（advanceProfile 会重算），
 * 所以必须同时把 bornAt 拉到当前时间，否则下一次推进又会变回成年。
 */
async function makeEgg(petId: string): Promise<void> {
  const now = harness.clock.now();
  await replaceProfile(harness, accountId, (current) => {
    const pet = current.pets[petId];
    if (pet === undefined) throw new Error('存档结构不符合预期');
    return {
      ...current,
      pets: {
        ...current.pets,
        [petId]: {
          ...pet,
          stage: 'egg',
          bornAt: now,
          stageChangedAt: now,
          updatedAt: now,
        },
      },
    };
  });
}

/** 追加一只成年宠物，用来验证"超过 3 只"的拒绝路径。 */
async function addExtraAdult(): Promise<string> {
  let extraId = '';
  await replaceProfile(harness, accountId, (current) => {
    const template = Object.values(current.pets)[0];
    if (template === undefined) throw new Error('存档结构不符合预期');
    extraId = `${template.id}_copy`;
    const extra: PetInstance = { ...template, id: extraId, habitatId: null, name: '额外' };
    return { ...current, pets: { ...current.pets, [extraId]: extra } };
  });
  return extraId;
}

describe('POST /lineup/set', () => {
  it('设置 2 只出战并返回 patch，防守阵容不联动', async () => {
    const ids = await petIds();
    const selected = ids.slice(0, 2);

    const response = await setLineup(selected, 'lineup-1', 0);
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(1);

    const data = response.body.data as ProfileWriteResponse;
    expect(data.patch.lineup).toEqual(selected);

    const profile = await readProfile();
    expect(profile.lineup).toEqual(selected);
    expect(profile.pvp.defense).toEqual([]);
  });

  it('空数组可以清空编队', async () => {
    const ids = await petIds();
    await setLineup(ids.slice(0, 2), 'lineup-set', 0);

    const cleared = await setLineup([], 'lineup-clear', 1);
    expect(cleared.status).toBe(200);
    expect((await readProfile()).lineup).toEqual([]);
  });

  it('超过 3 只返回 INVALID_LINEUP', async () => {
    const ids = await petIds();
    await addExtraAdult();
    const four = [...ids, ...(await petIds())].slice(0, 4);

    const response = await setLineup(four, 'lineup-4', 0);
    expect(response.status).toBe(400);
    expectError(response, 'INVALID_LINEUP');
    expect((await readProfile()).lineup).toEqual([]);
  });

  it('引用不存在的宠物返回 INVALID_LINEUP', async () => {
    const response = await setLineup(['pet_missing'], 'lineup-missing', 0);
    expect(response.status).toBe(400);
    expectError(response, 'INVALID_LINEUP');
  });

  it('重复同一只返回 INVALID_LINEUP', async () => {
    const ids = await petIds();
    const first = ids[0];
    if (first === undefined) throw new Error('初始化失败');

    const response = await setLineup([first, first], 'lineup-dup', 0);
    expect(response.status).toBe(400);
    expectError(response, 'INVALID_LINEUP');
  });

  it('蛋不能上阵（INVALID_LINEUP）', async () => {
    const egg = (await petIds())[0];
    if (egg === undefined) throw new Error('初始化失败');
    await makeEgg(egg);

    const response = await setLineup([egg], 'lineup-egg', 0);
    expect(response.status).toBe(400);
    expectError(response, 'INVALID_LINEUP');
  });

  it('petIds 不是数组返回 VALIDATION_FAILED', async () => {
    const response = await setLineup('not-an-array', 'lineup-bad', 0);
    expect(response.status).toBe(400);
    expectError(response, 'VALIDATION_FAILED');
  });

  it('未登录返回 401；缺 baseRevision 返回 400', async () => {
    const unauthenticated = await post(
      harness,
      '/lineup/set',
      { petIds: [] },
      { 'idempotency-key': 'lineup-401', 'x-base-revision': '0' },
    );
    expect(unauthenticated.status).toBe(401);
    expectError(unauthenticated, 'UNAUTHENTICATED');

    const noRevision = await post(
      harness,
      '/lineup/set',
      { petIds: [] },
      { ...authHeaders(token), 'idempotency-key': 'lineup-norev' },
    );
    expect(noRevision.status).toBe(400);
    expectError(noRevision, 'VALIDATION_FAILED');
  });

  it('同 key 重放返回同一结果，revision 不重复推进', async () => {
    const ids = await petIds();
    const selected = ids.slice(0, 2);

    const first = await setLineup(selected, 'lineup-replay', 0);
    const replay = await setLineup(selected, 'lineup-replay', 0);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect((await readProfile()).revision).toBe(1);
  });

  it('过期 baseRevision 返回 409', async () => {
    const ids = await petIds();
    await setLineup(ids.slice(0, 1), 'lineup-a', 0);

    const stale = await setLineup(ids.slice(0, 2), 'lineup-b', 0);
    expect(stale.status).toBe(409);
    expectError(stale, 'REVISION_CONFLICT');
  });
});
