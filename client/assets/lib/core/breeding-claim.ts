// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 繁殖蛋领取（contract-v1.5 E-07）。
 *
 * 只负责“从 `breeding.eggs` 出栏”：不推进阶段（服务端先 `advanceProfile` 让蛋孵化）、
 * 不写 revision、不推进时间。
 */
import type { ClaimBreedingResult } from './api';
import type { ConfigRepo } from './config/types';
import { BreedingClaimError, TimeError } from './errors';
import { buildProfilePatch } from './profile-patch';
import type { EpochMs } from './types/common';
import type { PetId } from './types/pet';
import type { Profile } from './types/profile';

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
