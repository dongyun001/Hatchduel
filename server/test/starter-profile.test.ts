import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkBreeding } from '@petbattle/core';
import type { CodexKey, ConfigRepo, PetInstance, Profile } from '@petbattle/core';
import type { GetProfileResponse } from '@petbattle/protocol';

import {
  STARTER_GENE,
  STARTER_HABITAT_CONFIG_ID,
  STARTER_HABITAT_ID,
  STARTER_HABITAT_LEVEL,
  STARTER_PET_SPECS,
} from '../src/domain/starter-profile.js';
import { testConfigRepo } from './fixtures.js';
import {
  authHeaders,
  get,
  guestLogin,
  loadProfile,
  startTestServer,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let repo: ConfigRepo;
let accountId: string;
let token: string;
let profile: Profile;

beforeEach(async () => {
  harness = await startTestServer();
  repo = await testConfigRepo();

  const login = await guestLogin(harness, 'device-starter');
  accountId = login.data.account.id;
  token = login.data.token;

  const call = await get(harness, '/profile', authHeaders(token));
  expect(call.status).toBe(200);
  profile = (call.body.data as GetProfileResponse).profile;
});

afterEach(async () => {
  await harness.close();
});

function petsOf(profileValue: Profile): PetInstance[] {
  return Object.values(profileValue.pets);
}

describe('初始存档：三只成年宠', () => {
  it('数量、物种与属性符合 PRD §5.5', () => {
    const pets = petsOf(profile);
    expect(pets).toHaveLength(STARTER_PET_SPECS.length);

    for (const spec of STARTER_PET_SPECS) {
      const match = pets.find((pet) => pet.speciesId === spec.speciesId);
      expect(match, `缺少初始宠物 ${spec.speciesId}`).toBeDefined();
      if (match === undefined) continue;

      expect(match.elementId).toBe(spec.elementId);
      expect(match.gender).toBe(spec.gender);
      expect(match.genome.stats).toEqual({
        hp: STARTER_GENE,
        atk: STARTER_GENE,
        def: STARTER_GENE,
        spd: STARTER_GENE,
      });
      expect(match.traits).toEqual([]);
      expect(match.hiddenTraits).toEqual([]);
      expect(match.generation).toBe(1);
      expect(match.parents).toEqual([null, null]);
      expect(match.level).toBe(1);
      expect(match.exp).toBe(0);
      expect(match.locked).toBe(false);
      expect(match.condition).toEqual({ hunger: 100, mood: 100, hygiene: 100, health: 100 });
    }
  });

  it('1 公 1 母以上，且全部成年、可繁殖', () => {
    const pets = petsOf(profile);
    const males = pets.filter((pet) => pet.gender === 'male');
    const females = pets.filter((pet) => pet.gender === 'female');
    expect(males.length).toBeGreaterThanOrEqual(1);
    expect(females.length).toBeGreaterThanOrEqual(1);

    for (const pet of pets) {
      expect(pet.stage).toBe('adult');
      expect(pet.fertility.readyAt).toBeLessThanOrEqual(harness.clock.now());
      expect(pet.fertility.cooldownUntil).toBe(0);
    }

    const male = males[0];
    const female = females[0];
    if (male === undefined || female === undefined) throw new Error('缺少公母');

    const check = checkBreeding(male, female, harness.clock.now(), profile, repo);
    expect(check).toEqual({ ok: true, inbred: false });
  });

  it('栖息地 meadow 1 级，3 只占位 + 1 空，宠物回指栖息地', () => {
    const habitats = Object.values(profile.habitats);
    expect(habitats).toHaveLength(1);

    const habitat = habitats[0];
    if (habitat === undefined) throw new Error('缺少栖息地');
    expect(habitat.id).toBe(STARTER_HABITAT_ID);
    expect(habitat.configId).toBe(STARTER_HABITAT_CONFIG_ID);
    expect(habitat.level).toBe(STARTER_HABITAT_LEVEL);

    const capacity =
      repo
        .habitat(STARTER_HABITAT_CONFIG_ID)
        .upgrade.levels.find((level) => level.level === STARTER_HABITAT_LEVEL)?.capacity ?? 0;
    expect(habitat.slots).toHaveLength(capacity);

    const occupied = habitat.slots.filter((slot): slot is string => slot !== null);
    expect(occupied).toHaveLength(STARTER_PET_SPECS.length);
    expect(occupied.sort()).toEqual(petsOf(profile).map((pet) => pet.id).sort());
    expect(habitat.slots.at(-1)).toBeNull();

    for (const pet of petsOf(profile)) {
      expect(pet.habitatId).toBe(STARTER_HABITAT_ID);
    }
    expect(habitat.stored).toEqual({});
    expect(habitat.lastEvaluatedAt).toBe(harness.clock.now());
  });

  it('图鉴、资源、编队与 revision', () => {
    const keys = Object.keys(profile.codex).sort();
    expect(keys).toEqual(
      STARTER_PET_SPECS.map((spec) => `${spec.speciesId}:${spec.elementId}`).sort(),
    );
    for (const spec of STARTER_PET_SPECS) {
      const key = `${spec.speciesId}:${spec.elementId}` as CodexKey;
      expect(profile.codex[key]).toEqual({ seen: true, owned: true, bestGene: STARTER_GENE });
    }

    const starting = repo.economy().startingResources;
    expect(profile.currencies).toEqual({
      coin: starting.coin ?? 0,
      food: starting.food ?? 0,
      geneDust: starting.geneDust ?? 0,
      premium: starting.premium ?? 0,
    });

    expect(profile.lineup).toEqual([]);
    expect(profile.pvp.defense).toEqual([]);
    expect(profile.breeding).toEqual({ eggs: [], cooldowns: {} });
    expect(profile.revision).toBe(0);
    expect(profile.createdAt).toBe(harness.clock.now());
    expect(profile.lastEvaluatedAt).toBe(harness.clock.now());
  });
});

describe('初始存档：幂等', () => {
  it('同 device 重复登录不会重复建宠', async () => {
    const before = await loadProfile(harness, accountId);
    const beforeIds = Object.keys(before.pets).sort();

    const again = await guestLogin(harness, 'device-starter', 'login-again');
    expect(again.data.account.id).toBe(accountId);
    expect(again.data.profileRevision).toBe(0);

    const after = await loadProfile(harness, accountId);
    expect(Object.keys(after.pets).sort()).toEqual(beforeIds);
    expect(Object.keys(after.pets)).toHaveLength(STARTER_PET_SPECS.length);
    expect(Object.keys(after.habitats)).toHaveLength(1);
  });
});
