import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CodexKey, PetInstance, Profile } from '@petbattle/core';
import type { GetProfileResponse, ProfileWriteResponse, ReleasePetResponse } from '@petbattle/protocol';

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
  const login = await guestLogin(harness, 'device-pets');
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

function call(
  method: 'rename' | 'lock' | 'release',
  petId: string,
  body: unknown,
  key: string,
  baseRevision: number,
): Promise<HttpCall> {
  return post(harness, `/pets/${petId}/${method}`, body, {
    ...authHeaders(token),
    'idempotency-key': key,
    'x-base-revision': String(baseRevision),
  });
}

/** 把宠物移出栖息地槽位：模拟"之后会有移出栖息地的端点"，用于放生的成功路径。 */
async function moveOutOfHabitat(petId: string): Promise<void> {
  await replaceProfile(harness, accountId, (current) => {
    const pet = current.pets[petId];
    const habitat = Object.values(current.habitats)[0];
    if (pet === undefined || habitat === undefined) throw new Error('存档结构不符合预期');
    return {
      ...current,
      pets: { ...current.pets, [petId]: { ...pet, habitatId: null } },
      habitats: {
        ...current.habitats,
        [habitat.id]: {
          ...habitat,
          slots: habitat.slots.map((slot) => (slot === petId ? null : slot)),
        },
      },
    };
  });
}

async function deletePetsExcept(keep: readonly string[]): Promise<void> {
  await replaceProfile(harness, accountId, (current) => {
    const pets: Profile['pets'] = {};
    for (const [id, pet] of Object.entries(current.pets)) {
      if (keep.includes(id)) pets[id] = pet;
    }
    const habitats: Profile['habitats'] = {};
    for (const [id, habitat] of Object.entries(current.habitats)) {
      habitats[id] = {
        ...habitat,
        slots: habitat.slots.map((slot) => (slot !== null && keep.includes(slot) ? slot : null)),
      };
    }
    return { ...current, pets, habitats };
  });
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

describe('POST /pets/:id/rename', () => {
  it('改名成功：写回名字并返回 patch', async () => {
    const pet = await petBySpecies('turtle');
    const response = await call('rename', pet.id, { name: '  阿龟  ' }, 'pet-rename-1', 0);

    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(1);

    const data = response.body.data as ProfileWriteResponse;
    expect(data.patch.fromRevision).toBe(0);
    expect(data.patch.toRevision).toBe(1);
    expect(data.patch.pets?.upsert?.[0]?.name).toBe('阿龟');

    const stored = await readProfile();
    expect(stored.pets[pet.id]?.name).toBe('阿龟');
    expect(stored.revision).toBe(1);
  });

  it('未登录返回 401', async () => {
    const pet = await petBySpecies('turtle');
    const response = await post(
      harness,
      `/pets/${pet.id}/rename`,
      { name: 'x' },
      { 'idempotency-key': 'k', 'x-base-revision': '0' },
    );
    expect(response.status).toBe(401);
    expectError(response, 'UNAUTHENTICATED');
  });

  it('宠物不存在返回 PET_NOT_FOUND', async () => {
    const response = await call('rename', 'pet_missing', { name: 'x' }, 'pet-rename-404', 0);
    expect(response.status).toBe(404);
    expectError(response, 'PET_NOT_FOUND');
  });

  it('名字为空或过长返回 VALIDATION_FAILED', async () => {
    const pet = await petBySpecies('turtle');
    const empty = await call('rename', pet.id, { name: '   ' }, 'pet-rename-empty', 0);
    expect(empty.status).toBe(400);
    expectError(empty, 'VALIDATION_FAILED');

    const tooLong = await call('rename', pet.id, { name: 'x'.repeat(13) }, 'pet-rename-long', 0);
    expect(tooLong.status).toBe(400);
    expectError(tooLong, 'VALIDATION_FAILED');
  });

  it('缺 baseRevision 返回 VALIDATION_FAILED', async () => {
    const pet = await petBySpecies('turtle');
    const response = await post(
      harness,
      `/pets/${pet.id}/rename`,
      { name: 'x' },
      { ...authHeaders(token), 'idempotency-key': 'no-rev' },
    );
    expect(response.status).toBe(400);
    expectError(response, 'VALIDATION_FAILED');
  });

  it('过期 baseRevision 返回 409', async () => {
    const pet = await petBySpecies('turtle');
    await call('rename', pet.id, { name: 'first' }, 'pet-rename-a', 0);
    const stale = await call('rename', pet.id, { name: 'second' }, 'pet-rename-b', 0);
    expect(stale.status).toBe(409);
    expectError(stale, 'REVISION_CONFLICT');
  });

  it('同 key 重放返回同一结果，不重复推进 revision', async () => {
    const pet = await petBySpecies('turtle');
    const first = await call('rename', pet.id, { name: '缓存的' }, 'pet-rename-replay', 0);
    const replay = await call('rename', pet.id, { name: '缓存的' }, 'pet-rename-replay', 0);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await readProfile()).revision).toBe(1);
  });
});

describe('POST /pets/:id/lock', () => {
  it('锁定与解锁都写回 locked 标记', async () => {
    const pet = await petBySpecies('turtle');

    const locked = await call('lock', pet.id, { locked: true }, 'pet-lock-1', 0);
    expect(locked.status).toBe(200);
    expect((await readProfile()).pets[pet.id]?.locked).toBe(true);

    const unlocked = await call('lock', pet.id, { locked: false }, 'pet-lock-2', 1);
    expect(unlocked.status).toBe(200);
    expect((await readProfile()).pets[pet.id]?.locked).toBe(false);
  });

  it('locked 非布尔值返回 VALIDATION_FAILED', async () => {
    const pet = await petBySpecies('turtle');
    const response = await call('lock', pet.id, { locked: 'true' }, 'pet-lock-bad', 0);
    expect(response.status).toBe(400);
    expectError(response, 'VALIDATION_FAILED');
  });

  it('宠物不存在返回 PET_NOT_FOUND', async () => {
    const response = await call('lock', 'pet_missing', { locked: true }, 'pet-lock-404', 0);
    expect(response.status).toBe(404);
    expectError(response, 'PET_NOT_FOUND');
  });
});

describe('POST /pets/:id/release', () => {
  it('栖息地中的宠物拒绝放生（PET_IN_USE）', async () => {
    const pet = await petBySpecies('turtle');
    const response = await call('release', pet.id, {}, 'release-habitat', 0);

    expect(response.status).toBe(409);
    expectError(response, 'PET_IN_USE');
    expect((await readProfile()).pets[pet.id]).toBeDefined();
  });

  it('锁定的宠物拒绝放生（PET_LOCKED）', async () => {
    const pet = await petBySpecies('turtle');
    await call('lock', pet.id, { locked: true }, 'release-lock-lock', 0);

    const response = await call('release', pet.id, {}, 'release-lock', 1);
    expect(response.status).toBe(409);
    expectError(response, 'PET_LOCKED');
  });

  it('上阵的宠物拒绝放生（PET_IN_USE）', async () => {
    const pet = await petBySpecies('turtle');
    const lineup = await post(
      harness,
      '/lineup/set',
      { petIds: [pet.id] },
      { ...authHeaders(token), 'idempotency-key': 'release-lineup-set', 'x-base-revision': '0' },
    );
    expect(lineup.status).toBe(200);

    const response = await call('release', pet.id, {}, 'release-lineup', 1);
    expect(response.status).toBe(409);
    expectError(response, 'PET_IN_USE');
  });

  it('蛋拒绝放生（EGG_NOT_RELEASABLE）', async () => {
    const pet = await petBySpecies('frog');
    await makeEgg(pet.id);

    const response = await call('release', pet.id, {}, 'release-egg', 0);
    expect(response.status).toBe(409);
    expectError(response, 'EGG_NOT_RELEASABLE');
  });

  it('最后一只成年拒绝放生（LAST_ADULT）', async () => {
    const pet = await petBySpecies('turtle');
    await moveOutOfHabitat(pet.id);
    await deletePetsExcept([pet.id]);

    const response = await call('release', pet.id, {}, 'release-last', 0);
    expect(response.status).toBe(409);
    expectError(response, 'LAST_ADULT');
  });

  it('成功放生：返还基因尘、移除宠物、图鉴不回退、写审计', async () => {
    const pet = await petBySpecies('turtle');
    await moveOutOfHabitat(pet.id);

    const before = await readProfile();
    const refundExpectedAtLeast = 1;

    const response = await call('release', pet.id, {}, 'release-ok', 0);
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(1);

    const data = response.body.data as ReleasePetResponse;
    expect(data.refund.geneDust).toBeGreaterThanOrEqual(refundExpectedAtLeast);
    expect(data.patch.pets?.remove).toContain(pet.id);

    const after = await readProfile();
    expect(after.pets[pet.id]).toBeUndefined();
    expect(after.currencies.geneDust).toBe(
      before.currencies.geneDust + (data.refund.geneDust ?? 0),
    );
    expect(after.stats.released).toBe(1);
    expect(after.revision).toBe(1);

    // 图鉴 owned 不回退（放生只是不再拥有个体，图鉴是收集记录）。
    const codexKey = `${pet.speciesId}:${pet.elementId}` as CodexKey;
    expect(after.codex[codexKey]).toEqual({ seen: true, owned: true, bestGene: 50 });

    // 栖息地槽位不残留（放生只在宠物不在栖息地时允许，但再确认一次）。
    const habitat = Object.values(after.habitats)[0];
    expect(habitat?.slots ?? []).not.toContain(pet.id);

    const audits = harness.store.listAudits();
    const releaseAudit = audits.find((entry) => entry.action === 'pet.release');
    expect(releaseAudit?.detail).toMatchObject({ petId: pet.id });
  });

  it('不存在的宠物返回 PET_NOT_FOUND', async () => {
    const response = await call('release', 'pet_missing', {}, 'release-404', 0);
    expect(response.status).toBe(404);
    expectError(response, 'PET_NOT_FOUND');
  });

  it('放生后同一 key 重放返回同一结果，不重复返还', async () => {
    const pet = await petBySpecies('turtle');
    await moveOutOfHabitat(pet.id);

    const first = await call('release', pet.id, {}, 'release-replay', 0);
    const replay = await call('release', pet.id, {}, 'release-replay', 0);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect((await readProfile()).currencies.geneDust).toBe(
      (first.body.data as ReleasePetResponse).refund.geneDust,
    );
  });
});
