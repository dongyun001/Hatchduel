import { describe, expect, it } from 'vitest';

import { BreedingClaimError, TimeError, claimBreeding } from '@petbattle/core';

import { T0, makePet, makeProfile } from './factory.js';
import { makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();

function profileWithEgg(stage: 'egg' | 'juvenile' | 'adult') {
  const egg = makePet({ id: 'egg_1', stage, updatedAt: T0 });
  const profile = makeProfile([egg], []);
  profile.breeding.eggs = ['egg_1'];
  return { egg, profile };
}

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BreedingClaimError);
    return (error as BreedingClaimError).reason;
  }
  throw new Error('expected BreedingClaimError');
}

describe('claimBreeding（E-07）', () => {
  it('宠物不存在 → not_found', () => {
    const profile = makeProfile([], []);
    expect(reasonOf(() => claimBreeding(profile, 'ghost', T0, cfg))).toBe('not_found');
  });

  it('仍在 eggs 且还是蛋 → egg_not_ready', () => {
    const { profile } = profileWithEgg('egg');
    expect(reasonOf(() => claimBreeding(profile, 'egg_1', T0, cfg))).toBe('egg_not_ready');
  });

  it('不在 eggs 但宠物存在 → already_claimed', () => {
    const { profile } = profileWithEgg('juvenile');
    profile.breeding.eggs = [];
    expect(reasonOf(() => claimBreeding(profile, 'egg_1', T0, cfg))).toBe('already_claimed');
  });

  it('成功：从 eggs 移除、返回 pet、不改 stage', () => {
    const { egg, profile } = profileWithEgg('juvenile');
    const result = claimBreeding(profile, 'egg_1', T0, cfg);

    expect(result.pet).toEqual(egg);
    expect(result.pet.stage).toBe('juvenile');
    expect(result.profile.pets['egg_1']).toEqual(egg);
    expect(result.profile.breeding.eggs).toEqual([]);
    expect(result.profile.lastEvaluatedAt).toBe(profile.lastEvaluatedAt);
    expect(result.patch.fromRevision).toBe(profile.revision);
    expect(result.patch.toRevision).toBe(profile.revision);
    expect(result.patch.breeding?.eggs).toEqual([]);
    expect(result.patch.pets).toBeUndefined();
  });

  it('已成年也按“已孵化”领取', () => {
    const { profile } = profileWithEgg('adult');
    const result = claimBreeding(profile, 'egg_1', T0, cfg);
    expect(result.profile.breeding.eggs).toEqual([]);
  });

  it('时间倒退抛 TimeError', () => {
    const { profile } = profileWithEgg('juvenile');
    expect(() => claimBreeding(profile, 'egg_1', T0 - 1, cfg)).toThrow(TimeError);
  });

  it('不修改入参 profile', () => {
    const { profile } = profileWithEgg('juvenile');
    const before = JSON.stringify(profile);
    claimBreeding(profile, 'egg_1', T0, cfg);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('同一输入两次领取结果一致（幂等键重放由服务端保证）', () => {
    const first = claimBreeding(profileWithEgg('juvenile').profile, 'egg_1', T0, cfg);
    const second = claimBreeding(profileWithEgg('juvenile').profile, 'egg_1', T0, cfg);
    expect(second).toEqual(first);
  });
});
