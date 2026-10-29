/**
 * 存档读写流水线（ONLINE_DESIGN §4.2）：
 *
 * ```
 * 加锁 → 读档 → 校验 baseRevision → core.advanceProfile(now) → 端点改动 → revision++ → CAS 落库 → 返回 patch
 * ```
 *
 * 顺序不可交换：先校验 revision 再推进，避免过期客户端白白触发一次时间推进；
 * 落库用 revision CAS，失败即返回最新快照让客户端重建（PITFALLS P-029 / P-105）。
 *
 * 服务端只决定“能不能做”，结果由 core 计算；端点不得自己改资源/宠物数值。
 */
import type { Profile, ProfilePatch } from '@petbattle/core';
import type { ProfileWriteResponse, RevisionConflictDetails } from '@petbattle/protocol';

import type { KeyedMutex } from '../concurrency.js';
import type { CoreAdapter } from '../domain/core-adapter.js';
import { composePatch } from '../domain/patch.js';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { Store } from '../storage/types.js';

export interface ProfileServiceDeps {
  store: Store;
  core: CoreAdapter;
  mutex: KeyedMutex;
  logger: Logger;
}

export interface MutationOutcome {
  /** 改动后的 profile（没改动就原样返回）。 */
  profile: Profile;
  /** 端点自己的增量；core 的推进增量会自动合并。 */
  patch?: Partial<ProfilePatch>;
}

export interface RunWriteParams {
  accountId: string;
  baseRevision: number;
  now: number;
  requestId?: string;
  auditAction?: string;
  auditDetail?: unknown;
  mutate: (profile: Profile, now: number) => Promise<MutationOutcome>;
}

export interface RunWriteResult {
  profile: Profile;
  patch: ProfilePatch;
}

export interface RenameResult {
  data: ProfileWriteResponse;
  revision: number;
}

export class ProfileService {
  constructor(private readonly deps: ProfileServiceDeps) {}

  async get(accountId: string): Promise<Profile> {
    const profile = await this.deps.store.getProfile(accountId);
    if (profile === undefined) throw new AppError('NOT_FOUND', '存档不存在');
    return profile;
  }

  async rename(params: {
    accountId: string;
    displayName: string;
    baseRevision: number;
    now: number;
    requestId?: string;
  }): Promise<RenameResult> {
    const { accountId, displayName, baseRevision, now, requestId } = params;

    const { profile, patch } = await this.runWrite({
      accountId,
      baseRevision,
      now,
      requestId,
      auditAction: 'profile.rename',
      auditDetail: { displayName },
      mutate: async (current) => {
        // displayName 属于账号而不是 Profile；客户端已知道自己提交的新名字，
        // 所以 patch 不需要额外字段，但 revision 必须推进以便客户端确认写入生效。
        await this.deps.store.updateAccountDisplayName(accountId, displayName);
        return { profile: current };
      },
    });

    return {
      data: {
        patch,
        revision: profile.revision,
        serverTime: now,
      },
      revision: profile.revision,
    };
  }

  async runWrite(params: RunWriteParams): Promise<RunWriteResult> {
    const { accountId, baseRevision, now, mutate } = params;
    const { store, core, mutex, logger } = this.deps;

    return mutex.run(accountId, async () => {
      const current = await store.getProfile(accountId);
      if (current === undefined) throw new AppError('NOT_FOUND', '存档不存在');

      if (current.revision !== baseRevision) throw revisionConflict(current, baseRevision);

      const advanced = core.advanceProfile(current, now);
      const outcome = await mutate(advanced.profile, now);

      const nextRevision = baseRevision + 1;
      const nextProfile: Profile = { ...outcome.profile, revision: nextRevision };

      const saved = await store.saveProfile(nextProfile, baseRevision);
      if (!saved) {
        const latest = await store.getProfile(accountId);
        if (latest === undefined) throw new AppError('NOT_FOUND', '存档不存在');
        throw revisionConflict(latest, baseRevision);
      }

      if (params.auditAction !== undefined) {
        try {
          await store.appendAudit({
            at: now,
            accountId,
            action: params.auditAction,
            detail: params.auditDetail,
            requestId: params.requestId,
          });
        } catch (error) {
          // 审计失败不回滚业务写入，但必须告警；否则经济问题无法追溯。
          logger.error('审计写入失败', {
            accountId,
            action: params.auditAction,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const patch = composePatch(advanced.patch, outcome.patch, {
        from: baseRevision,
        to: nextRevision,
        at: now,
        lastEvaluatedAt: nextProfile.lastEvaluatedAt,
      });

      return { profile: nextProfile, patch };
    });
  }
}

function revisionConflict(latest: Profile, expected: number): AppError {
  const details: RevisionConflictDetails = {
    latestProfile: latest,
    latestRevision: latest.revision,
  };
  return new AppError(
    'REVISION_CONFLICT',
    `revision 冲突：客户端 baseRevision=${expected}，服务器最新=${latest.revision}`,
    { details },
  );
}
