import type { EpochMs, Profile } from '../../lib/core';

/**
 * 离线 mock 动作（仅 `remote.mode === 'mock'` 时使用）。
 *
 * 这些函数**不是**业务规则：服务端接入后，喂食/收取等写操作必须走
 * `/habitat/*` 端点，由服务器用 core 计算并返回 ProfilePatch。
 * 这里只是让 UI 在没有服务端时能演示 store 单向数据流。
 */
export function cloneProfile(profile: Profile): Profile {
  return JSON.parse(JSON.stringify(profile)) as Profile;
}

export function collectStored(profile: Profile, now: EpochMs): { profile: Profile; collected: number } {
  const next = cloneProfile(profile);
  let collected = 0;
  for (const habitat of Object.values(next.habitats)) {
    for (const [resource, amount] of Object.entries(habitat.stored)) {
      if (amount === undefined) continue;
      const key = resource as keyof Profile['currencies'];
      next.currencies[key] = (next.currencies[key] ?? 0) + amount;
      if (resource === 'coin') collected += amount;
    }
    habitat.stored = {};
    habitat.lastEvaluatedAt = now;
  }
  next.lastEvaluatedAt = now;
  return { profile: next, collected };
}

export function feedAll(profile: Profile, now: EpochMs): { profile: Profile; fed: number; message: string } {
  const next = cloneProfile(profile);
  let fed = 0;
  for (const pet of Object.values(next.pets)) {
    if (pet.habitatId === null) continue;
    if ((next.currencies.food ?? 0) <= 0) break;
    next.currencies.food -= 1;
    pet.condition.hunger = Math.min(100, pet.condition.hunger + 25);
    pet.condition.mood = Math.min(100, pet.condition.mood + 3);
    pet.updatedAt = now;
    fed += 1;
  }
  next.lastEvaluatedAt = now;
  const message = fed > 0 ? `喂食 ${fed} 只（离线演示，未经过服务端）` : '食物不足，无法喂食';
  return { profile: next, fed, message };
}
