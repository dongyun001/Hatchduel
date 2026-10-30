import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConfigRepo, PetInstance, Profile } from '@petbattle/core';
import type {
  ClaimBreedingResponse,
  GetProfileResponse,
  StartBreedingResponse,
} from '@petbattle/protocol';

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

let harness: TestHarness;
let cfg: ConfigRepo;
let accountId: string;
let token: string;

beforeEach(async () => {
  harness = await startTestServer();
  cfg = await testConfigRepo();
  const login = await guestLogin(harness, 'device-breeding');
  accountId = login.data.account.id;
  token = login.data.token;
});

afterEach(async () => {
  await harness.close();
});

async function revision(): Promise<number> {
  return (await loadProfile(harness, accountId)).revision;
}

/**
 * 推进 2.5 小时后 access token（2h）会过期；测试里重新登录拿新 token，
 * 模拟“玩家隔天回来领蛋”的真实路径。
 */
async function relogin(): Promise<void> {
  const again = await guestLogin(harness, 'device-breeding', `relogin-${randomUUID()}`);
  token = again.data.token;
}

async function readProfile(): Promise<Profile> {
  const call = await get(harness, '/profile', authHeaders(token));
  expect(call.status).toBe(200);
  return (call.body.data as GetProfileResponse).profile;
}

async function petsBySpecies(speciesId: string): Promise<PetInstance> {
  const profile = await readProfile();
  const pet = Object.values(profile.pets).find((entry) => entry.speciesId === speciesId);
  if (pet === undefined) throw new Error(`初始档缺少 ${speciesId}`);
  return pet;
}

function start(parentA: string, parentB: string, key: string, baseRevision: number): Promise<HttpCall> {
  return post(harness, '/breeding/start', { parentA, parentB }, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

function claim(eggId: string, key: string, baseRevision: number): Promise<HttpCall> {
  return post(harness, '/breeding/claim', { eggId }, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

describe('POST /breeding/start', () => {
  it('成功繁殖：返回蛋与 inbred，扣成本并写父母冷却', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    const before = await readProfile();

    const response = await start(male.id, female.id, 'breed-start-1', before.revision);
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(before.revision + 1);

    const data = response.body.data as StartBreedingResponse;
    expect(data.egg.stage).toBe('egg');
    expect(data.egg.generation).toBe(2);
    expect(data.egg.parents).toEqual([male.id, female.id]);
    expect(data.inbred).toBe(false);

    const after = await readProfile();
    expect(after.pets[data.egg.id]).toBeDefined();
    expect(after.breeding.eggs).toContain(data.egg.id);
    expect(after.stats.breeds).toBe(1);

    const cost = cfg.breeding().cost;
    for (const item of cost) {
      const spent = item.amount;
      expect(after.currencies[item.resource]).toBe((before.currencies[item.resource] ?? 0) - spent);
    }

    const parentAfter = after.pets[male.id];
    expect(parentAfter?.fertility.cooldownUntil).toBeGreaterThan(harness.clock.now());
  });

  it('同一只 / 同性别 / 蛋阶段 / 未知 id 的拒绝', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    const otherMale = await petsBySpecies('frog');

    const base = await revision();
    const samePet = await start(male.id, male.id, 'breed-same', base);
    expect(samePet.status).toBe(400);
    expectError(samePet, 'VALIDATION_FAILED');

    const sameGender = await start(male.id, otherMale.id, 'breed-gender', base);
    expect(sameGender.status).toBe(400);
    expectError(sameGender, 'VALIDATION_FAILED');

    const missing = await start(male.id, 'pet_missing', 'breed-missing', base);
    expect(missing.status).toBe(404);
    expectError(missing, 'NOT_FOUND');

    // 把 female 改成刚出生的蛋：阶段校验失败。
    const now = harness.clock.now();
    await replaceProfile(harness, accountId, (current) => {
      const pet = current.pets[female.id];
      if (pet === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        pets: {
          ...current.pets,
          [female.id]: { ...pet, stage: 'egg', bornAt: now, stageChangedAt: now, updatedAt: now },
        },
      };
    });
    const notAdult = await start(male.id, female.id, 'breed-egg', await revision());
    expect(notAdult.status).toBe(400);
    expectError(notAdult, 'VALIDATION_FAILED');
  });

  it('锁定父母返回 PET_LOCKED', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');

    const locked = await post(
      harness,
      `/pets/${male.id}/lock`,
      { locked: true },
      { ...authHeaders(token), 'idempotency-key': 'breed-lock', 'x-base-revision': '0' },
    );
    expect(locked.status).toBe(200);

    const response = await start(male.id, female.id, 'breed-locked-start', await revision());
    expect(response.status).toBe(409);
    expectError(response, 'PET_LOCKED');
  });

  it('资源不足返回 INSUFFICIENT_RESOURCES', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    await replaceProfile(harness, accountId, (current) => ({
      ...current,
      currencies: { ...current.currencies, coin: 0, food: 0 },
    }));

    const response = await start(male.id, female.id, 'breed-poor', await revision());
    expect(response.status).toBe(409);
    expectError(response, 'INSUFFICIENT_RESOURCES');
  });

  it('容量满返回 CAPACITY_FULL', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    // 3 只宠物 + 2 个未领取蛋 = 5，已超过草甸 1 级的 4 格。
    await replaceProfile(harness, accountId, (current) => ({
      ...current,
      breeding: { ...current.breeding, eggs: ['egg_a', 'egg_b'] },
    }));

    const response = await start(male.id, female.id, 'breed-full', await revision());
    expect(response.status).toBe(409);
    expectError(response, 'CAPACITY_FULL');
  });

  it('冷却中再次繁殖返回 COOLDOWN_ACTIVE；同键重放返回同一结果', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');

    const base = await revision();
    const first = await start(male.id, female.id, 'breed-cd-1', base);
    expect(first.status).toBe(200);

    // 幂等重放必须完全相同的请求（含 baseRevision），否则应视为新请求。
    const replay = await start(male.id, female.id, 'breed-cd-1', base);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');

    const again = await start(male.id, female.id, 'breed-cd-2', await revision());
    expect(again.status).toBe(409);
    expectError(again, 'COOLDOWN_ACTIVE');
  });

  it('未登录 401；缺 baseRevision 400', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');

    const unauthenticated = await post(
      harness,
      '/breeding/start',
      { parentA: male.id, parentB: female.id },
      { 'idempotency-key': 'k', 'x-base-revision': '0' },
    );
    expect(unauthenticated.status).toBe(401);

    const noRevision = await post(
      harness,
      '/breeding/start',
      { parentA: male.id, parentB: female.id },
      { ...authHeaders(token), 'idempotency-key': 'breed-norev' },
    );
    expect(noRevision.status).toBe(400);
    expectError(noRevision, 'VALIDATION_FAILED');
  });
});

describe('POST /breeding/claim', () => {
  it('蛋未孵化返回 EGG_NOT_READY；推进时间后可领取且 hatchlings +1', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    const started = await start(male.id, female.id, 'claim-breed-1', await revision());
    const egg = (started.body.data as StartBreedingResponse).egg;

    const early = await claim(egg.id, 'claim-early', await revision());
    expect(early.status).toBe(409);
    expectError(early, 'EGG_NOT_READY');

    const breeding = cfg.breeding();
    harness.clock.advance(breeding.hatchMs + breeding.juvenileMs + 1);
    await relogin();

    const before = await readProfile();
    const response = await claim(egg.id, 'claim-1', before.revision);
    expect(response.status).toBe(200);

    const data = response.body.data as ClaimBreedingResponse;
    expect(data.pet.id).toBe(egg.id);
    expect(data.pet.stage).not.toBe('egg');

    const after = await readProfile();
    expect(after.breeding.eggs).not.toContain(egg.id);
    expect(after.pets[egg.id]).toBeDefined();
    expect(after.stats.hatchlings).toBe(before.stats.hatchlings + 1);
    expect(response.body.revision).toBe(before.revision + 1);
  });

  it('同键重放一致；新键重复领取 ALREADY_CLAIMED；未知蛋 NOT_FOUND', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    const started = await start(male.id, female.id, 'claim-breed-2', await revision());
    const egg = (started.body.data as StartBreedingResponse).egg;
    const breeding = cfg.breeding();
    harness.clock.advance(breeding.hatchMs + breeding.juvenileMs + 1);
    await relogin();

    const base = await revision();
    const first = await claim(egg.id, 'claim-replay', base);
    expect(first.status).toBe(200);

    const replay = await claim(egg.id, 'claim-replay', base);
    expect(replay.body).toEqual(first.body);
    expect((await readProfile()).stats.hatchlings).toBe(1);

    const again = await claim(egg.id, 'claim-new-key', await revision());
    expect(again.status).toBe(409);
    expectError(again, 'ALREADY_CLAIMED');

    const missing = await claim('egg_missing', 'claim-missing', await revision());
    expect(missing.status).toBe(404);
    expectError(missing, 'NOT_FOUND');
  });

  it('未登录 401；过期 baseRevision 409', async () => {
    const male = await petsBySpecies('turtle');
    const female = await petsBySpecies('fish');
    const started = await start(male.id, female.id, 'claim-breed-3', await revision());
    const egg = (started.body.data as StartBreedingResponse).egg;
    const breeding = cfg.breeding();
    harness.clock.advance(breeding.hatchMs + breeding.juvenileMs + 1);
    await relogin();

    const unauthenticated = await post(
      harness,
      '/breeding/claim',
      { eggId: egg.id },
      { 'idempotency-key': 'k', 'x-base-revision': String(await revision()) },
    );
    expect(unauthenticated.status).toBe(401);

    const stale = await claim(egg.id, 'claim-stale', 0);
    expect(stale.status).toBe(409);
    expectError(stale, 'REVISION_CONFLICT');
  });
});
