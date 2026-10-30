/**
 * core 桥接层：服务端唯一的领域入口。
 *
 * 规则（AGENTS §3.3 / CONTRACT §8.3）：
 * - 时间推进、繁殖、战斗、经济一律调用 `@petbattle/core`，服务端不重写；
 * - core 尚未实现时（M1 早期，A 还在补）允许“恒等推进”，否则所有写操作都会 501，
 *   登录/改名等与领域无关的契约测试跑不起来；
 * - 恒等推进**不伪造**任何领域结果：不改宠物、不产资源，只把 patch 的 revision/时间补齐；
 * - 可通过 `PETBATTLE_CORE_STUB=strict` 关闭降级，让未实现直接暴露为 501。
 */
import {
  CoreNotImplementedError,
  advanceProfile as coreAdvanceProfile,
  cleanPet as coreCleanPet,
  collectHabitat as coreCollectHabitat,
  feedPet as coreFeedPet,
  movePetToHabitat as coreMovePetToHabitat,
  playWithPet as corePlayWithPet,
  releasePet as coreReleasePet,
  upgradeHabitat as coreUpgradeHabitat,
} from '@petbattle/core';
import type {
  ConfigRepo,
  EpochMs,
  HabitatId,
  Id,
  PetId,
  Profile,
  ProfilePatch,
  ReleaseResult,
} from '@petbattle/core';

import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { identityPatch } from './patch.js';

export interface AdvanceResult {
  profile: Profile;
  patch: ProfilePatch;
  /** true 表示这次没有真正推进（core 仍是契约桩，或配置仓库不可用）。 */
  degraded: boolean;
}

/** 栖息地操作统一返回；`patch` 的 revision 由服务端写操作覆写（DOMAIN §15.7）。 */
export interface HabitatOpResult {
  profile: Profile;
  patch: ProfilePatch;
}

export interface CoreAdapter {
  advanceProfile(profile: Profile, now: EpochMs): AdvanceResult;
  /** 放生：拒绝原因由 core 抛 `ReleaseError`，服务端按 reason 映射错误码。 */
  releasePet(profile: Profile, petId: PetId, now: EpochMs): ReleaseResult;

  // 栖息地操作（contract-v1.3 D-12）：失败抛 `name='HabitatError'` 的 Error，按 code 映射。
  movePetToHabitat(
    profile: Profile,
    petId: PetId,
    habitatId: HabitatId | null,
    now: EpochMs,
  ): HabitatOpResult;
  feedPet(profile: Profile, petId: PetId, foodId: Id, now: EpochMs): HabitatOpResult;
  cleanPet(profile: Profile, petId: PetId, now: EpochMs): HabitatOpResult;
  playWithPet(profile: Profile, petId: PetId, now: EpochMs): HabitatOpResult;
  upgradeHabitat(profile: Profile, habitatId: HabitatId, now: EpochMs): HabitatOpResult;
  collectHabitat(profile: Profile, habitatId: HabitatId, now: EpochMs): HabitatOpResult;

  /** 是否曾经降级过；用于日志告警与运维排查。 */
  readonly degraded: boolean;
}

export interface CoreAdapterOptions {
  allowStub: boolean;
  logger: Logger;
  /** A 的 `createConfigRepo` 可用时传入；null 表示配置仓库不可用。 */
  configRepo?: ConfigRepo;
}

export function createCoreAdapter(options: CoreAdapterOptions): CoreAdapter {
  let degraded = false;
  let warned = false;

  const warnOnce = (reason: string): void => {
    degraded = true;
    if (warned) return;
    warned = true;
    options.logger.warn('领域推进降级为恒等推进（仅用于契约联调；PETBATTLE_CORE_STUB=strict 可关闭）', {
      reason,
    });
  };

  /** 放生/繁殖这类必须读配置的操作没有降级余地：没配置就直接报配置错误。 */
  const requireRepo = (): ConfigRepo => {
    const repo = options.configRepo;
    if (repo === undefined) {
      throw new AppError('CONFIG_INVALID', '配置仓库不可用，无法执行需要配置的领域操作');
    }
    return repo;
  };

  return {
    advanceProfile(profile, now) {
      const repo = options.configRepo;
      if (repo === undefined) {
        // strict 模式必须暴露失败，不能静默降级（CONTRACT §8.3：生产不允许假推进）。
        if (!options.allowStub) {
          throw new CoreNotImplementedError('createConfigRepo（配置仓库不可用）');
        }
        warnOnce('配置仓库不可用（createConfigRepo 尚未实现或配置目录缺失）');
        return { profile, patch: identityPatch(profile, now), degraded: true };
      }

      try {
        const result = coreAdvanceProfile(profile, now, repo);
        return { profile: result.profile, patch: result.patch, degraded: false };
      } catch (error) {
        if (!(error instanceof CoreNotImplementedError)) throw error;
        if (!options.allowStub) throw error;
        warnOnce('core.advanceProfile 尚未实现');
        return { profile, patch: identityPatch(profile, now), degraded: true };
      }
    },

    releasePet(profile, petId, now) {
      return coreReleasePet(profile, petId, now, requireRepo());
    },

    movePetToHabitat(profile, petId, habitatId, now) {
      return coreMovePetToHabitat(profile, petId, habitatId, now, requireRepo());
    },

    feedPet(profile, petId, foodId, now) {
      return coreFeedPet(profile, petId, foodId, now, requireRepo());
    },

    cleanPet(profile, petId, now) {
      return coreCleanPet(profile, petId, now, requireRepo());
    },

    playWithPet(profile, petId, now) {
      return corePlayWithPet(profile, petId, now, requireRepo());
    },

    upgradeHabitat(profile, habitatId, now) {
      return coreUpgradeHabitat(profile, habitatId, now, requireRepo());
    },

    collectHabitat(profile, habitatId, now) {
      return coreCollectHabitat(profile, habitatId, now, requireRepo());
    },

    get degraded() {
      return degraded;
    },
  };
}
