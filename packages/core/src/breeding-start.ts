/**
 * 繁殖编排（contract-v1.4 D-17）。
 *
 * 纯函数：不推进时间（服务端先 `advanceProfile`），不写 revision。
 * 流程：查父母 → `checkBreeding` → 扣 `breeding.cost` → `breed` → 落蛋 + 父母冷却 + stats.breeds。
 * 失败统一抛 `BreedingError(reason)`。
 */
import type { ConfigRepo } from './config/types.js';
import type { StartBreedingResult } from './api.js';
import { breedImpl, checkBreedingImpl } from './breeding.js';
import { BreedingError, TimeError } from './errors.js';
import type { EpochMs, Id, Rng } from './types/common.js';
import type { PetId, PetInstance } from './types/pet.js';
import type { Profile } from './types/profile.js';
import { buildProfilePatch } from './profile-patch.js';

export function startBreedingImpl(
  profile: Profile,
  parentAId: PetId,
  parentBId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
  rng: Rng,
): StartBreedingResult {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');

  const parentA = profile.pets[parentAId];
  const parentB = profile.pets[parentBId];
  if (!parentA || !parentB) throw new BreedingError('not_found');

  const check = checkBreedingImpl(parentA, parentB, now, profile, cfg);
  if (!check.ok) throw new BreedingError(check.reason ?? 'infertile');

  // 扣费（checkBreeding 已校验；这里按实际扣减，防止两个校验口径漂移）。
  const cost = cfg.breeding().cost;
  const currencies = { ...profile.currencies };
  for (const item of cost) {
    if ((currencies[item.resource] ?? 0) < item.amount) throw new BreedingError('cost');
  }
  for (const item of cost) {
    currencies[item.resource] = (currencies[item.resource] ?? 0) - item.amount;
  }

  const { child, inbred, parentCooldowns } = breedImpl(parentA, parentB, now, cfg, rng);

  const nextA: PetInstance = {
    ...parentA,
    fertility: { ...parentA.fertility, cooldownUntil: parentCooldowns[0] },
    updatedAt: now,
  };
  const nextB: PetInstance = {
    ...parentB,
    fertility: { ...parentB.fertility, cooldownUntil: parentCooldowns[1] },
    updatedAt: now,
  };

  const pets: Profile['pets'] = {
    ...profile.pets,
    [nextA.id]: nextA,
    [nextB.id]: nextB,
    [child.id]: child,
  };
  const cooldowns: Record<Id, EpochMs> = {
    ...profile.breeding.cooldowns,
    [nextA.id]: parentCooldowns[0],
    [nextB.id]: parentCooldowns[1],
  };

  const next: Profile = {
    ...profile,
    currencies,
    pets,
    breeding: { eggs: [...profile.breeding.eggs, child.id], cooldowns },
    stats: { ...profile.stats, breeds: profile.stats.breeds + 1 },
  };

  return {
    profile: next,
    patch: buildProfilePatch(profile, next, now),
    child,
    inbred,
    parentCooldowns,
  };
}
