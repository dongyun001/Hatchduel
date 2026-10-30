import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConfigRepo, HabitatId, PetInstance, Profile } from '@petbattle/core';
import type {
  CollectHabitatResponse,
  GetProfileResponse,
  ProfileWriteResponse,
} from '@petbattle/protocol';

import { STARTER_HABITAT_ID } from '../src/domain/starter-profile.js';
import { testConfigRepo } from './fixtures.js';
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
let repo: ConfigRepo;
let accountId: string;
let token: string;

const HABITAT: HabitatId = STARTER_HABITAT_ID;

beforeEach(async () => {
  harness = await startTestServer();
  repo = await testConfigRepo();
  const login = await guestLogin(harness, 'device-habitat');
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

async function petBySpecies(speciesId: string): Promise<PetInstance> {
  const profile = await readProfile();
  const pet = Object.values(profile.pets).find((entry) => entry.speciesId === speciesId);
  if (pet === undefined) throw new Error(`初始档缺少 ${speciesId}`);
  return pet;
}

function habitatOp(
  path: 'move' | 'collect' | 'feed' | 'clean' | 'play' | 'upgrade',
  body: unknown,
  key: string,
  baseRevision: number,
): Promise<HttpCall> {
  return post(harness, `/habitat/${path}`, body, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

/** 追加一只"不在栖息地"的成年宠物，用来测容量与放生闭环。 */
async function addExtraAdult(suffix: string): Promise<string> {
  let extraId = '';
  await replaceProfile(harness, accountId, (current) => {
    const template = Object.values(current.pets)[0];
    if (template === undefined) throw new Error('存档结构不符合预期');
    extraId = `${template.id}_${suffix}`;
    const extra: PetInstance = { ...template, id: extraId, habitatId: null, name: suffix };
    return { ...current, pets: { ...current.pets, [extraId]: extra } };
  });
  return extraId;
}

async function patchProfile(mutate: (profile: Profile) => Profile): Promise<void> {
  await replaceProfile(harness, accountId, mutate);
}

async function makeEgg(petId: string): Promise<void> {
  const now = harness.clock.now();
  await patchProfile((current) => {
    const pet = current.pets[petId];
    if (pet === undefined) throw new Error('存档结构不符合预期');
    return {
      ...current,
      pets: {
        ...current.pets,
        [petId]: { ...pet, stage: 'egg', bornAt: now, stageChangedAt: now, updatedAt: now },
      },
    };
  });
}

describe('POST /habitat/move', () => {
  it('移出栖息地后宠物不再占槽，可以放生（闭环）', async () => {
    const pet = await petBySpecies('turtle');

    const moved = await habitatOp('move', { petId: pet.id, habitatId: null }, 'move-out', 0);
    expect(moved.status).toBe(200);
    expect(moved.body.revision).toBe(1);

    const afterMove = await readProfile();
    expect(afterMove.pets[pet.id]?.habitatId).toBeNull();
    expect(afterMove.habitats[HABITAT]?.slots).not.toContain(pet.id);

    const released = await post(
      harness,
      `/pets/${pet.id}/release`,
      {},
      { ...authHeaders(token), 'idempotency-key': 'move-release', 'x-base-revision': '1' },
    );
    expect(released.status).toBe(200);
    expect((await readProfile()).pets[pet.id]).toBeUndefined();
  });

  it('移出后可以再放回栖息地，槽位重新占用', async () => {
    const pet = await petBySpecies('fish');
    await habitatOp('move', { petId: pet.id, habitatId: null }, 'move-out', 0);

    const movedBack = await habitatOp(
      'move',
      { petId: pet.id, habitatId: HABITAT },
      'move-in',
      1,
    );
    expect(movedBack.status).toBe(200);

    const profile = await readProfile();
    expect(profile.pets[pet.id]?.habitatId).toBe(HABITAT);
    expect(profile.habitats[HABITAT]?.slots).toContain(pet.id);
  });

  it('容量满返回 CAPACITY_FULL', async () => {
    const first = await addExtraAdult('a');
    const second = await addExtraAdult('b');

    // 草甸 1 级 4 格：初始 3 只 + 第 4 只刚好占满。
    const ok = await habitatOp('move', { petId: first, habitatId: HABITAT }, 'move-fill', 0);
    expect(ok.status).toBe(200);
    expect((await readProfile()).habitats[HABITAT]?.slots.filter(Boolean)).toHaveLength(4);

    const full = await habitatOp('move', { petId: second, habitatId: HABITAT }, 'move-full', 1);
    expect(full.status).toBe(409);
    expectError(full, 'CAPACITY_FULL');
  });

  it('蛋不能放入栖息地（VALIDATION_FAILED）', async () => {
    const pet = await petBySpecies('frog');
    await makeEgg(pet.id);

    const response = await habitatOp('move', { petId: pet.id, habitatId: null }, 'move-egg', 0);
    expect(response.status).toBe(400);
    expectError(response, 'VALIDATION_FAILED');
  });

  it('宠物或栖息地不存在返回 404', async () => {
    const missingPet = await habitatOp(
      'move',
      { petId: 'pet_missing', habitatId: null },
      'move-missing-pet',
      0,
    );
    expect(missingPet.status).toBe(404);
    expectError(missingPet, 'PET_NOT_FOUND');

    const pet = await petBySpecies('turtle');
    const missingHabitat = await habitatOp(
      'move',
      { petId: pet.id, habitatId: 'habitat_missing' },
      'move-missing-habitat',
      0,
    );
    expect(missingHabitat.status).toBe(404);
    expectError(missingHabitat, 'NOT_FOUND');
  });

  it('缺少 habitatId 字段返回 VALIDATION_FAILED', async () => {
    const pet = await petBySpecies('turtle');
    const response = await habitatOp('move', { petId: pet.id }, 'move-bad', 0);
    expect(response.status).toBe(400);
    expectError(response, 'VALIDATION_FAILED');
  });

  it('未登录 401、缺 baseRevision 400、同 key 重放一致', async () => {
    const pet = await petBySpecies('turtle');

    const unauthenticated = await post(
      harness,
      '/habitat/move',
      { petId: pet.id, habitatId: null },
      { 'idempotency-key': 'move-401', 'x-base-revision': '0' },
    );
    expect(unauthenticated.status).toBe(401);

    const noRevision = await post(
      harness,
      '/habitat/move',
      { petId: pet.id, habitatId: null },
      { ...authHeaders(token), 'idempotency-key': 'move-norev' },
    );
    expect(noRevision.status).toBe(400);
    expectError(noRevision, 'VALIDATION_FAILED');

    const first = await habitatOp('move', { petId: pet.id, habitatId: null }, 'move-replay', 0);
    const replay = await habitatOp('move', { petId: pet.id, habitatId: null }, 'move-replay', 0);
    expect(replay.body).toEqual(first.body);
    expect((await readProfile()).revision).toBe(1);
  });
});

describe('POST /habitat/collect', () => {
  it('整数部分入账，零头留在 stored', async () => {
    await patchProfile((current) => {
      const habitat = current.habitats[HABITAT];
      if (habitat === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        habitats: { ...current.habitats, [HABITAT]: { ...habitat, stored: { coin: 12.5, food: 3 } } },
      };
    });

    const before = await readProfile();
    const response = await habitatOp('collect', { habitatId: HABITAT }, 'collect-1', 0);
    expect(response.status).toBe(200);

    const data = response.body.data as CollectHabitatResponse;
    expect(data.collected).toEqual({ coin: 12, food: 3 });
    expect(data.revision).toBe(1);

    const after = await readProfile();
    expect(after.currencies.coin).toBe(before.currencies.coin + 12);
    expect(after.currencies.food).toBe(before.currencies.food + 3);
    expect(after.habitats[HABITAT]?.stored.coin).toBeCloseTo(0.5);
  });

  it('没有可领取整数时 collected 为空，不改变货币', async () => {
    await patchProfile((current) => {
      const habitat = current.habitats[HABITAT];
      if (habitat === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        habitats: { ...current.habitats, [HABITAT]: { ...habitat, stored: { coin: 0.4 } } },
      };
    });

    const before = await readProfile();
    const response = await habitatOp('collect', { habitatId: HABITAT }, 'collect-empty', 0);
    expect(response.status).toBe(200);
    expect((response.body.data as CollectHabitatResponse).collected).toEqual({});
    expect((await readProfile()).currencies.coin).toBe(before.currencies.coin);
  });

  it('栖息地不存在返回 404；同 key 重放不重复入账', async () => {
    const missing = await habitatOp('collect', { habitatId: 'habitat_missing' }, 'collect-404', 0);
    expect(missing.status).toBe(404);
    expectError(missing, 'NOT_FOUND');

    await patchProfile((current) => {
      const habitat = current.habitats[HABITAT];
      if (habitat === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        habitats: { ...current.habitats, [HABITAT]: { ...habitat, stored: { coin: 7 } } },
      };
    });

    const before = await readProfile();
    const first = await habitatOp('collect', { habitatId: HABITAT }, 'collect-replay', 0);
    const replay = await habitatOp('collect', { habitatId: HABITAT }, 'collect-replay', 0);

    expect(replay.body).toEqual(first.body);
    expect((await readProfile()).currencies.coin).toBe(before.currencies.coin + 7);
  });
});

describe('POST /habitat/feed', () => {
  it('扣食物成本并恢复 hunger / mood', async () => {
    const pet = await petBySpecies('turtle');
    await patchProfile((current) => {
      const target = current.pets[pet.id];
      if (target === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        pets: {
          ...current.pets,
          [pet.id]: { ...target, condition: { ...target.condition, hunger: 10, mood: 10 } },
        },
      };
    });

    const before = await readProfile();
    const food = repo.food('berry');
    const response = await habitatOp('feed', { petId: pet.id, foodId: 'berry' }, 'feed-1', 0);
    expect(response.status).toBe(200);

    const after = await readProfile();
    const expectedHunger = Math.min(100, 10 + food.nutrition);
    expect(after.pets[pet.id]?.condition.hunger).toBe(expectedHunger);
    expect(after.pets[pet.id]?.condition.mood).toBe(Math.min(100, 10 + food.mood));
    const coinCost = food.cost.find((cost) => cost.resource === 'coin')?.amount ?? 0;
    expect(after.currencies.coin).toBe(before.currencies.coin - coinCost);
  });

  it('资源不足返回 INSUFFICIENT_RESOURCES', async () => {
    const pet = await petBySpecies('turtle');
    await patchProfile((current) => ({ ...current, currencies: { ...current.currencies, coin: 0 } }));

    const response = await habitatOp('feed', { petId: pet.id, foodId: 'berry' }, 'feed-poor', 0);
    expect(response.status).toBe(409);
    expectError(response, 'INSUFFICIENT_RESOURCES');
  });

  it('食物或宠物不存在返回 404；蛋不能喂食', async () => {
    const pet = await petBySpecies('turtle');

    const unknownFood = await habitatOp(
      'feed',
      { petId: pet.id, foodId: 'no_such_food' },
      'feed-404-food',
      0,
    );
    expect(unknownFood.status).toBe(404);
    expectError(unknownFood, 'NOT_FOUND');

    const unknownPet = await habitatOp(
      'feed',
      { petId: 'pet_missing', foodId: 'berry' },
      'feed-404-pet',
      0,
    );
    expect(unknownPet.status).toBe(404);
    expectError(unknownPet, 'PET_NOT_FOUND');

    const egg = await petBySpecies('frog');
    await makeEgg(egg.id);
    const eggFeed = await habitatOp('feed', { petId: egg.id, foodId: 'berry' }, 'feed-egg', 0);
    expect(eggFeed.status).toBe(400);
    expectError(eggFeed, 'VALIDATION_FAILED');
  });
});

describe('POST /habitat/clean 与 /habitat/play', () => {
  it('清洁恢复 hygiene、陪玩恢复 mood，且不消耗资源', async () => {
    const pet = await petBySpecies('turtle');
    await patchProfile((current) => {
      const target = current.pets[pet.id];
      if (target === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        pets: {
          ...current.pets,
          [pet.id]: { ...target, condition: { ...target.condition, hygiene: 5, mood: 5 } },
        },
      };
    });

    const before = await readProfile();
    const cleaned = await habitatOp('clean', { petId: pet.id }, 'clean-1', 0);
    expect(cleaned.status).toBe(200);

    const afterClean = await readProfile();
    expect(afterClean.pets[pet.id]?.condition.hygiene).toBeGreaterThan(5);
    expect(afterClean.pets[pet.id]?.condition.hygiene).toBeLessThanOrEqual(100);
    expect(afterClean.currencies).toEqual(before.currencies);

    const played = await habitatOp('play', { petId: pet.id }, 'play-1', 1);
    expect(played.status).toBe(200);
    const afterPlay = await readProfile();
    expect(afterPlay.pets[pet.id]?.condition.mood).toBeGreaterThan(5);
    expect(afterPlay.currencies).toEqual(before.currencies);
  });

  it('宠物不存在返回 PET_NOT_FOUND', async () => {
    const cleanMissing = await habitatOp('clean', { petId: 'pet_missing' }, 'clean-404', 0);
    expect(cleanMissing.status).toBe(404);
    expectError(cleanMissing, 'PET_NOT_FOUND');
  });
});

describe('POST /habitat/upgrade', () => {
  it('资源不足返回 INSUFFICIENT_RESOURCES', async () => {
    const response = await habitatOp('upgrade', { habitatId: HABITAT }, 'upgrade-poor', 0);
    expect(response.status).toBe(409);
    expectError(response, 'INSUFFICIENT_RESOURCES');
  });

  it('升级成功：扣配置成本、扩容量；到上限返回 VALIDATION_FAILED', async () => {
    const config = repo.habitat('meadow');
    const level2 = config.upgrade.levels.find((level) => level.level === 2);
    const level3 = config.upgrade.levels.find((level) => level.level === 3);
    if (level2 === undefined || level3 === undefined) throw new Error('栖息地配置缺少升级等级');

    await patchProfile((current) => ({
      ...current,
      currencies: { coin: 100000, food: 1000, geneDust: 10000, premium: 0 },
    }));

    const before = await readProfile();
    const up2 = await habitatOp('upgrade', { habitatId: HABITAT }, 'upgrade-2', 0);
    expect(up2.status).toBe(200);

    const after2 = await readProfile();
    expect(after2.habitats[HABITAT]?.level).toBe(2);
    expect(after2.habitats[HABITAT]?.slots).toHaveLength(level2.capacity);
    expect(after2.currencies.coin).toBe(
      before.currencies.coin - (level2.cost.find((cost) => cost.resource === 'coin')?.amount ?? 0),
    );

    const up3 = await habitatOp('upgrade', { habitatId: HABITAT }, 'upgrade-3', 1);
    expect(up3.status).toBe(200);
    expect((await readProfile()).habitats[HABITAT]?.level).toBe(3);

    const maxed = await habitatOp('upgrade', { habitatId: HABITAT }, 'upgrade-max', 2);
    expect(maxed.status).toBe(400);
    expectError(maxed, 'VALIDATION_FAILED');
  });

  it('栖息地不存在返回 404', async () => {
    const response = await habitatOp(
      'upgrade',
      { habitatId: 'habitat_missing' },
      'upgrade-404',
      0,
    );
    expect(response.status).toBe(404);
    expectError(response, 'NOT_FOUND');
  });
});

describe('放生闭环：防守阵容', () => {
  it('防守阵容中的宠物放生返回 PET_IN_USE', async () => {
    const pet = await petBySpecies('turtle');
    await habitatOp('move', { petId: pet.id, habitatId: null }, 'defense-move-out', 0);
    await patchProfile((current) => ({ ...current, pvp: { ...current.pvp, defense: [pet.id] } }));

    const response = await post(
      harness,
      `/pets/${pet.id}/release`,
      {},
      { ...authHeaders(token), 'idempotency-key': 'defense-release', 'x-base-revision': '1' },
    );
    expect(response.status).toBe(409);
    expectError(response, 'PET_IN_USE');
    expect((await readProfile()).pets[pet.id]).toBeDefined();
  });
});

describe('写操作通用约束', () => {
  it('六个端点都要求 Idempotency-Key + X-Base-Revision', async () => {
    const pet = await petBySpecies('turtle');
    const endpoints: Array<[string, unknown]> = [
      ['move', { petId: pet.id, habitatId: null }],
      ['collect', { habitatId: HABITAT }],
      ['feed', { petId: pet.id, foodId: 'berry' }],
      ['clean', { petId: pet.id }],
      ['play', { petId: pet.id }],
      ['upgrade', { habitatId: HABITAT }],
    ];

    for (const [path, body] of endpoints) {
      const noKey = await post(harness, `/habitat/${path}`, body, {
        ...authHeaders(token),
        'x-base-revision': '0',
      });
      expect(noKey.status, `${path} 缺 key`).toBe(400);
      expectError(noKey, 'VALIDATION_FAILED');

      const noRevision = await post(harness, `/habitat/${path}`, body, {
        ...authHeaders(token),
        'idempotency-key': `${path}-norev`,
      });
      expect(noRevision.status, `${path} 缺 revision`).toBe(400);
      expectError(noRevision, 'VALIDATION_FAILED');
    }
  });

  it('patch 中 currencies 是绝对值而不是增量', async () => {
    await patchProfile((current) => {
      const habitat = current.habitats[HABITAT];
      if (habitat === undefined) throw new Error('存档结构不符合预期');
      return {
        ...current,
        habitats: { ...current.habitats, [HABITAT]: { ...habitat, stored: { coin: 5 } } },
      };
    });

    const before = await readProfile();
    const response = await habitatOp('collect', { habitatId: HABITAT }, 'collect-abs', 0);
    const data = response.body.data as CollectHabitatResponse;
    expect(data.patch.currencies?.coin).toBe(before.currencies.coin + 5);
    expect(data.patch.currencies?.food).toBe(before.currencies.food);
    expect(data.patch.currencies?.geneDust).toBe(before.currencies.geneDust);
    void (data as ProfileWriteResponse);
  });
});
