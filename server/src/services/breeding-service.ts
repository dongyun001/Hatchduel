/**
 * 繁殖端点服务（CONTRACT §7.4 E-07，DOMAIN §8）。
 *
 * - `start`：`core.startBreeding` 负责校验、扣费、遗传、落蛋与父母冷却；
 * - `claim`：`core.claimBreeding` 只负责把蛋从 `breeding.eggs` 出栏；
 *   `stats.hatchlings +1` 由服务端维护（E-07a，core 不处理统计）。
 *
 * 随机源：繁殖结果由服务器生成并落库、不重放，这里注入 CSPRNG（见 `domain/rng.ts`）。
 */
import type { PetId, PetInstance } from '@petbattle/core';
import type { ClaimBreedingResponse, StartBreedingResponse } from '@petbattle/protocol';

import type { CoreAdapter } from '../domain/core-adapter.js';
import { createSecureRng } from '../domain/rng.js';
import { AppError } from '../errors.js';
import type { ProfileService } from './profile-service.js';

export interface BreedingServiceDeps {
  core: CoreAdapter;
  profiles: ProfileService;
}

export interface StartBreedingParams {
  accountId: string;
  parentA: unknown;
  parentB: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface ClaimBreedingParams {
  accountId: string;
  eggId: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface BreedingWriteResult {
  data: StartBreedingResponse | ClaimBreedingResponse;
  revision: number;
}

export class BreedingService {
  constructor(private readonly deps: BreedingServiceDeps) {}

  async start(params: StartBreedingParams): Promise<BreedingWriteResult> {
    const { accountId, parentA, parentB, baseRevision, now } = params;
    const parentAId = requireId(parentA, 'parentA');
    const parentBId = requireId(parentB, 'parentB');
    const rng = createSecureRng();

    let egg: PetInstance | undefined;
    let inbred = false;

    const { profile, patch } = await this.deps.profiles.runWrite({
      accountId,
      baseRevision,
      now,
      requestId: params.requestId,
      auditAction: 'breeding.start',
      auditDetail: () => ({ parentA: parentAId, parentB: parentBId, eggId: egg?.id ?? null, inbred }),
      mutate: async (current, nowInner) => {
        const result = this.deps.core.startBreeding(current, parentAId, parentBId, nowInner, rng);
        egg = result.child;
        inbred = result.inbred;
        return { profile: result.profile, patch: result.patch };
      },
    });

    if (egg === undefined) throw new AppError('INTERNAL', '繁殖未返回子代');

    return {
      data: { egg, inbred, patch, revision: profile.revision, serverTime: now },
      revision: profile.revision,
    };
  }

  async claim(params: ClaimBreedingParams): Promise<BreedingWriteResult> {
    const { accountId, eggId, baseRevision, now } = params;
    const id = requireId(eggId, 'eggId');

    let pet: PetInstance | undefined;

    const { profile, patch } = await this.deps.profiles.runWrite({
      accountId,
      baseRevision,
      now,
      requestId: params.requestId,
      auditAction: 'breeding.claim',
      auditDetail: () => ({ eggId: id, petId: pet?.id ?? null }),
      mutate: async (current, nowInner) => {
        const claimed = this.deps.core.claimBreeding(current, id, nowInner);
        pet = claimed.pet;

        // E-07a：孵化统计由服务端维护；core 只管 eggs 与宠物。
        const stats = {
          ...claimed.profile.stats,
          hatchlings: claimed.profile.stats.hatchlings + 1,
        };
        return {
          profile: { ...claimed.profile, stats },
          patch: { ...claimed.patch, stats },
        };
      },
    });

    if (pet === undefined) throw new AppError('INTERNAL', '领取繁殖蛋未返回宠物');

    return {
      data: { pet, patch, revision: profile.revision, serverTime: now },
      revision: profile.revision,
    };
  }
}

function requireId(value: unknown, label: string): PetId {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${label} 必须是非空字符串`);
  }
  return value.trim();
}
