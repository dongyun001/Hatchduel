/**
 * 繁殖蛋领取（contract-v1.5 E-07）。
 *
 * 只负责“从 `breeding.eggs` 出栏”：不推进阶段（服务端先 `advanceProfile` 让蛋孵化）、
 * 不写 revision、不推进时间。
 */
import type { ClaimBreedingResult } from './api.js';
import type { ConfigRepo } from './config/types.js';
import { BreedingClaimError, TimeError } from './errors.js';
import { buildProfilePatch } from './profile-patch.js';
import type { EpochMs } from './types/common.js';
import type { PetId } from './types/pet.js';
import type { Profile } from './types/profile.js';

export function claimBreedingImpl(
  profile: Profile,
  eggId: PetId,
  now: EpochMs,
  _cfg: ConfigRepo,
): ClaimBreedingResult {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');

  const pet = profile.pets[eggId];
  if (!pet) throw new BreedingClaimError('not_found');

  const inEggs = profile.breeding.eggs.includes(eggId);
  if (inEggs && pet.stage === 'egg') throw new BreedingClaimError('egg_not_ready');
  if (!inEggs) throw new BreedingClaimError('already_claimed');

  const next: Profile = {
    ...profile,
    breeding: {
      eggs: profile.breeding.eggs.filter((id) => id !== eggId),
      cooldowns: { ...profile.breeding.cooldowns },
    },
  };

  return { profile: next, patch: buildProfilePatch(profile, next, now), pet };
}
