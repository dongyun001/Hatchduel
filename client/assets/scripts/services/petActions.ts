import { ReleaseError, applyProfilePatch, releasePet } from '../../lib/core';
import type { PetInstance, Profile, ResourceBag } from '../../lib/core';
import { appStore } from '../app/store';
import { cloneProfile } from '../dev/clone';
import { getApiClient, nowMs } from './bootstrap';
import { getConfigRepo } from './config';
import { apiErrorText, errorMessage } from './errors';
import type { ActionResult } from './errors';
import { movePetAction } from './habitatActions';

/** 放生拒绝原因（本地与服务端共用文案）。 */
const RELEASE_REASON: Record<string, string> = {
  pet_not_found: '宠物不存在',
  cannot_release_egg: '蛋不能放生',
  pet_locked: '宠物已锁定，先解锁',
  in_lineup: '在出战编队中，先更换编队',
  in_habitat: '在栖息地中，先移出',
  in_defense: '在 PvP 防守阵容中，先撤下',
  last_adult: '至少保留一只成年宠物',
  EGG_NOT_RELEASABLE: '蛋不能放生',
  PET_LOCKED: '宠物已锁定，先解锁',
  PET_IN_USE: '宠物在编队/防守/栖息地中，先移出',
  LAST_ADULT: '至少保留一只成年宠物',
  PET_NOT_FOUND: '宠物不存在',
};

export interface ReleasePreview {
  /** 除“在栖息地”外是否还有其他阻断（栖息地会在放生动作里自动移出）。 */
  blocked: boolean;
  reason?: string;
  needsMoveOut: boolean;
  /** 预计返还基因尘；无法预览时为 undefined。 */
  refund?: number;
}

export interface ReleaseActionResult extends ActionResult {
  refund?: ResourceBag;
}

export interface LockActionResult extends ActionResult {
  locked?: boolean;
}

function adultCount(profile: Profile): number {
  return Object.values(profile.pets).filter((pet) => pet.stage === 'adult' || pet.stage === 'elder').length;
}

/** 只做展示/前置提示；真正的拒绝以 core 或服务端为准。 */
export function previewRelease(profile: Profile, pet: PetInstance): ReleasePreview {
  if (pet.stage === 'egg') return { blocked: true, reason: RELEASE_REASON['cannot_release_egg'], needsMoveOut: false };
  if (pet.locked) return { blocked: true, reason: RELEASE_REASON['pet_locked'], needsMoveOut: false };
  if (profile.lineup.includes(pet.id)) return { blocked: true, reason: RELEASE_REASON['in_lineup'], needsMoveOut: false };
  if (profile.pvp.defense.includes(pet.id)) {
    return { blocked: true, reason: RELEASE_REASON['in_defense'], needsMoveOut: false };
  }
  if ((pet.stage === 'adult' || pet.stage === 'elder') && adultCount(profile) <= 1) {
    return { blocked: true, reason: RELEASE_REASON['last_adult'], needsMoveOut: false };
  }
  const needsMoveOut = pet.habitatId !== null;
  return { blocked: false, needsMoveOut, refund: previewRefund(profile, pet) };
}

/** 用 core 在副本上算返还；不重复公式。失败时返回 undefined。 */
function previewRefund(profile: Profile, pet: PetInstance): number | undefined {
  try {
    const clone = cloneProfile(profile);
    const target = clone.pets[pet.id];
    if (!target) return undefined;
    target.habitatId = null;
    for (const habitat of Object.values(clone.habitats)) {
      habitat.slots = habitat.slots.map((id) => (id === pet.id ? null : id));
    }
    const result = releasePet(clone, pet.id, nowMs(), getConfigRepo());
    return result.refund.geneDust ?? 0;
  } catch {
    return undefined;
  }
}

function isServerMode(): boolean {
  return appStore.getState().remote.mode === 'server';
}

/** 放生：栖息地中的宠物先自动移出；服务端模式走 /pets/:id/release。 */
export async function releasePetAction(petId: string): Promise<ReleaseActionResult> {
  let profile = appStore.getState().profile;
  const pet = profile?.pets[petId];
  if (!profile || !pet) return { ok: false, message: '宠物不存在' };

  // 先判断“移出也无法解决”的阻断（蛋/锁定/编队/防守/最后成年），避免无谓地把宠物移出栖息地。
  const preview = previewRelease(profile, pet);
  if (preview.blocked) {
    if (!isServerMode()) return { ok: false, message: `放生失败：${preview.reason ?? '条件不满足'}` };
  } else if (pet.habitatId !== null) {
    const moved = await movePetAction(petId, null);
    if (!moved.ok) return { ok: false, message: moved.message };
    profile = appStore.getState().profile;
    if (!profile) return { ok: false, message: '移出后存档缺失' };
  }

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.releasePet(petId);
    if (!res.ok || !res.data) {
      const code = res.error?.code;
      const text = code && RELEASE_REASON[code] ? RELEASE_REASON[code] : apiErrorText(code);
      return { ok: false, message: `放生失败：${text}` };
    }
    const data = res.data;
    appStore.setProfile(applyProfilePatch(profile, data.patch));
    return {
      ok: true,
      message: `已放生，返还基因尘 ${data.refund.geneDust ?? 0}`,
      refund: data.refund,
    };
  }

  try {
    const result = releasePet(profile, petId, nowMs(), getConfigRepo());
    // core 只返回 refund，不入账；离线模式由这里把返还写进 currencies（服务端由服务端写）。
    const next = cloneProfile(result.profile);
    for (const [resource, amount] of Object.entries(result.refund)) {
      if (amount === undefined) continue;
      const key = resource as keyof typeof next.currencies;
      next.currencies[key] = (next.currencies[key] ?? 0) + amount;
    }
    appStore.setProfile(next);
    return {
      ok: true,
      message: `已放生，返还基因尘 ${result.refund.geneDust ?? 0}（离线演示）`,
      refund: result.refund,
    };
  } catch (error) {
    if (error instanceof ReleaseError) {
      return { ok: false, message: `放生失败：${RELEASE_REASON[error.reason] ?? error.reason}` };
    }
    return { ok: false, message: `放生失败：${errorMessage(error)}` };
  }
}

/** 锁定/解锁：只改标记位，不推进时间。 */
export async function setPetLockAction(petId: string, locked: boolean): Promise<LockActionResult> {
  const profile = appStore.getState().profile;
  if (!profile || !profile.pets[petId]) return { ok: false, message: '宠物不存在' };

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.setPetLock(petId, locked);
    if (!res.ok || !res.data) {
      return { ok: false, message: `锁定失败：${apiErrorText(res.error?.code)}` };
    }
    appStore.setProfile(applyProfilePatch(profile, res.data.patch));
    return { ok: true, message: locked ? '已锁定' : '已解锁', locked };
  }

  const next = cloneProfile(profile);
  const pet = next.pets[petId];
  if (!pet) return { ok: false, message: '宠物不存在' };
  pet.locked = locked;
  appStore.setProfile(next);
  return { ok: true, message: locked ? '已锁定（离线演示）' : '已解锁（离线演示）', locked };
}
