import { advanceProfile, applyProfilePatch, BreedingClaimError, BreedingError, claimBreeding, startBreeding } from '../../lib/core';
import type { PetInstance, Profile } from '../../lib/core';
import { appStore } from '../app/store';
import { createMockRng } from '../dev/mockRng';
import { getApiClient, nowMs } from './bootstrap';
import { getConfigRepo } from './config';
import { apiErrorText, errorMessage } from './errors';
import type { ActionResult } from './errors';

/**
 * 繁殖编排：服务端模式走 `/breeding/start|claim` 并 applyProfilePatch；
 * 离线模式直接调 core 的 `startBreeding` / `claimBreeding`。两条路径返回同一结构。
 */
export interface StartBreedingActionResult extends ActionResult {
  egg?: PetInstance;
  inbred?: boolean;
  parentCooldowns?: [number, number];
}

export interface ClaimEggResult extends ActionResult {
  pet?: PetInstance;
}

const BREED_REASON: Record<string, string> = {
  not_found: '父母不存在',
  not_adult: '未到成年',
  same_pet: '不能和自己繁殖',
  same_gender: '需要一公一母',
  infertile: '不可繁殖',
  locked: '宠物已锁定',
  cooldown: '还在冷却中',
  no_capacity: '容量已满（先升级栖息地）',
  cost: '资源不足',
};

const CLAIM_REASON: Record<string, string> = {
  not_found: '蛋不存在',
  egg_not_ready: '蛋还没孵化',
  already_claimed: '已经领取过了',
};

function isServerMode(): boolean {
  return appStore.getState().remote.mode === 'server';
}

function profileOrNull(): Profile | null {
  return appStore.getState().profile;
}

function coreErrorText(error: unknown): string {
  if (error instanceof BreedingError) return BREED_REASON[error.reason] ?? error.reason;
  if (error instanceof BreedingClaimError) return CLAIM_REASON[error.reason] ?? error.reason;
  return errorMessage(error);
}

/** 蛋剩余孵化时间（毫秒）；0 表示可以尝试领取。 */
export function hatchRemainingMs(egg: PetInstance): number {
  const hatchMs = getConfigRepo().breeding().hatchMs;
  return Math.max(0, egg.bornAt + hatchMs - nowMs());
}

export async function startBreedingAction(
  parentA: string,
  parentB: string,
): Promise<StartBreedingActionResult> {
  const profile = profileOrNull();
  if (!profile) return { ok: false, message: '没有存档' };

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.startBreeding({ parentA, parentB });
    if (!res.ok || !res.data) {
      return { ok: false, message: `繁殖失败：${apiErrorText(res.error?.code)}` };
    }
    const data = res.data;
    appStore.setProfile(applyProfilePatch(profile, data.patch));
    return { ok: true, message: '已产蛋（服务端）', egg: data.egg, inbred: data.inbred };
  }

  try {
    const result = startBreeding(profile, parentA, parentB, nowMs(), getConfigRepo(), createMockRng());
    appStore.setProfile(result.profile);
    return {
      ok: true,
      message: '已产蛋（离线演示）',
      egg: result.child,
      inbred: result.inbred,
      parentCooldowns: result.parentCooldowns,
    };
  } catch (error) {
    return { ok: false, message: `繁殖失败：${coreErrorText(error)}` };
  }
}

export async function claimEggAction(eggId: string): Promise<ClaimEggResult> {
  const profile = profileOrNull();
  if (!profile) return { ok: false, message: '没有存档' };

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.claimBreeding({ eggId });
    if (!res.ok || !res.data) {
      return { ok: false, message: `领取失败：${apiErrorText(res.error?.code)}` };
    }
    const data = res.data;
    appStore.setProfile(applyProfilePatch(profile, data.patch));
    return { ok: true, message: '已领取（服务端）', pet: data.pet };
  }

  try {
    const result = claimBreeding(profile, eggId, nowMs(), getConfigRepo());
    appStore.setProfile(result.profile);
    return { ok: true, message: '已领取（离线演示）', pet: result.pet };
  } catch (error) {
    return { ok: false, message: `领取失败：${coreErrorText(error)}` };
  }
}

/**
 * 离线模式：蛋到孵化时间后推进一次 profile（阶段 → juvenile），让“领取”可用。
 * 服务端模式不本地推进：claim 端点会先 advanceProfile。
 */
export function tickEggHatch(): void {
  if (isServerMode()) return;
  const profile = profileOrNull();
  if (!profile) return;
  const cfg = getConfigRepo();
  const hatchMs = cfg.breeding().hatchMs;
  const now = nowMs();
  const ready = profile.breeding.eggs.some((id) => {
    const egg = profile.pets[id];
    return Boolean(egg && egg.stage === 'egg' && now >= egg.bornAt + hatchMs);
  });
  if (!ready) return;
  appStore.setProfile(advanceProfile(profile, now, cfg).profile);
}
