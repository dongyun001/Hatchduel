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
import { CoreNotImplementedError, advanceProfile as coreAdvanceProfile } from '@petbattle/core';
import type { ConfigRepo, EpochMs, Profile, ProfilePatch } from '@petbattle/core';

import type { Logger } from '../logger.js';
import { identityPatch } from './patch.js';

export interface AdvanceResult {
  profile: Profile;
  patch: ProfilePatch;
  /** true 表示这次没有真正推进（core 仍是契约桩，或配置仓库不可用）。 */
  degraded: boolean;
}

export interface CoreAdapter {
  advanceProfile(profile: Profile, now: EpochMs): AdvanceResult;
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

  return {
    advanceProfile(profile, now) {
      const repo = options.configRepo;
      if (repo === undefined) {
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

    get degraded() {
      return degraded;
    },
  };
}
