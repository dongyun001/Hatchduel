import { describe, expect, it } from 'vitest';

import {
  advanceProfile,
  applyProfilePatch,
  feedPet,
  releasePet,
  startBreeding,
  type ProfilePatch,
} from '@petbattle/core';

import { mulberry32 } from '../src/rng.js';
import { HOUR, T0, makePet, makeProfile } from './factory.js';
import { makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();
const NOW = T0 + HOUR;

function baseProfile() {
  const a = makePet({ id: 'a', gender: 'male', updatedAt: T0 });
  const b = makePet({ id: 'b', gender: 'female', updatedAt: T0 });
  return makeProfile([a, b], []);
}

function removalPatch(petId: string, revision: number): ProfilePatch {
  return {
    fromRevision: revision,
    toRevision: revision,
    at: NOW,
    lastEvaluatedAt: NOW,
    pets: { remove: [petId] },
  };
}

describe('组合写：advanceProfile → startBreeding → feedPet 按 patch 应用（P-047）', () => {
  it('推进 patch 应用到原档后与推进结果一致', () => {
    const base = baseProfile();
    const advanced = advanceProfile(base, NOW, cfg);

    const applied = applyProfilePatch(base, advanced.patch);
    expect(applied).toEqual(advanced.profile);
    expect(applied.revision).toBe(base.revision + 1);
    expect(applied.lastEvaluatedAt).toBe(NOW);
  });

  it('繁殖 patch 叠加在推进结果上：资源、蛋、冷却全部正确', () => {
    const base = baseProfile();
    const advanced = advanceProfile(base, NOW, cfg);
    const appliedAdvance = applyProfilePatch(base, advanced.patch);

    const bred = startBreeding(appliedAdvance, 'a', 'b', NOW, cfg, mulberry32(11));
    const appliedAll = applyProfilePatch(appliedAdvance, bred.patch);

    expect(appliedAll).toEqual(bred.profile);
    expect(appliedAll.currencies.coin).toBe(900);
    expect(appliedAll.currencies.food).toBe(80);
    expect(appliedAll.breeding.eggs).toEqual([bred.child.id]);
    expect(appliedAll.pets[bred.child.id]).toEqual(bred.child);
    expect(appliedAll.pets['a']!.fertility.cooldownUntil).toBe(bred.parentCooldowns[0]);
    expect(appliedAll.breeding.cooldowns['b']).toBe(bred.parentCooldowns[1]);
    expect(appliedAll.stats.breeds).toBe(1);
    // 推进结果里的 updatedAt 不会被繁殖 patch 打回旧值。
    expect(appliedAll.pets['a']!.updatedAt).toBe(NOW);
  });

  it('喂食 patch 继续叠加：货币不重复累加', () => {
    const base = baseProfile();
    const advanced = advanceProfile(base, NOW, cfg);
    const bred = startBreeding(advanced.profile, 'a', 'b', NOW, cfg, mulberry32(12));
    const fed = feedPet(bred.profile, 'a', 'kibble', NOW, cfg);

    let client = applyProfilePatch(base, advanced.patch);
    client = applyProfilePatch(client, bred.patch);
    client = applyProfilePatch(client, fed.patch);

    expect(client).toEqual(fed.profile);
    expect(client.currencies.coin).toBe(890);
    expect(client.stats.breeds).toBe(1);
  });

  it('放生不会让推进 patch 里 upsert 的宠物复活（remove 优先）', () => {
    const base = baseProfile();
    const advanced = advanceProfile(base, NOW, cfg);
    // 推进 patch 一定 upsert 了两只宠物（updatedAt 变了）。
    expect(advanced.patch.pets?.upsert?.map((pet) => pet.id).sort()).toEqual(['a', 'b']);

    const released = releasePet(advanced.profile, 'a', NOW, cfg);
    expect(released.profile.pets['a']).toBeUndefined();

    // 客户端先应用推进 patch，再应用删除 patch。
    const client = applyProfilePatch(base, advanced.patch);
    expect(client.pets['a']).toBeDefined();
    const afterRemove = applyProfilePatch(client, removalPatch('a', client.revision));
    expect(afterRemove.pets['a']).toBeUndefined();
    expect(afterRemove.pets['b']).toBeDefined();

    // 同一个 patch 里同时 upsert + remove 时删除生效。
    const combined: ProfilePatch = {
      fromRevision: client.revision,
      toRevision: client.revision,
      at: NOW,
      lastEvaluatedAt: NOW,
      pets: { upsert: advanced.patch.pets?.upsert, remove: ['a'] },
    };
    expect(applyProfilePatch(base, combined).pets['a']).toBeUndefined();
  });

  it('空 patch 应用后不影响繁殖/资源状态', () => {
    const base = baseProfile();
    const bred = startBreeding(base, 'a', 'b', NOW, cfg, mulberry32(13));
    const applied = applyProfilePatch(bred.profile, {
      fromRevision: bred.profile.revision,
      toRevision: bred.profile.revision,
      at: NOW,
      lastEvaluatedAt: bred.profile.lastEvaluatedAt,
    });
    expect(applied).toEqual(bred.profile);
  });
});
