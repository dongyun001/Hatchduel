import { cleanPet, collectHabitat, feedPet, movePetToHabitat, playWithPet, upgradeHabitat } from '../../lib/core';
import type { Profile } from '../../lib/core';
import { appStore } from '../app/store';
import { getApiClient, nowMs } from './bootstrap';
import { getConfigRepo } from './config';
import { apiErrorText, errorMessage } from './errors';
import type { ActionResult } from './errors';

/**
 * 栖息地动作：服务端模式走 ROUTES/ApiContract，离线模式走 core 纯函数。
 *
 * 切换点只有 `remote.mode`（由 DEV_CONFIG.useServer 决定）；控制器不关心来源。
 * 注意：core 的 `applyProfilePatch`（contract-v1.4 D-16）尚未落地，
 * 服务端写操作成功后暂时用 `GET /profile` 拉全量，不做客户端 patch 合并。
 */
function fail(action: string, error: unknown): ActionResult {
  return { ok: false, message: `${action}失败：${errorMessage(error)}` };
}

function isServerMode(): boolean {
  return appStore.getState().remote.mode === 'server';
}

function applyLocal(action: string, next: { profile: Profile }): ActionResult {
  appStore.setProfile(next.profile);
  return { ok: true, message: `${action}成功（离线演示）` };
}

function localProfile(): Profile | null {
  return appStore.getState().profile;
}

export async function collectHabitatAction(habitatId: string): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.collectHabitat({ habitatId });
    if (!res.ok) return { ok: false, message: `收取失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: '已收取产出' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('收取', collectHabitat(profile, habitatId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('收取', error);
  }
}

export async function feedPetAction(petId: string, foodId: string): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.feedPet({ petId, foodId });
    if (!res.ok) return { ok: false, message: `喂食失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: '已喂食' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('喂食', feedPet(profile, petId, foodId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('喂食', error);
  }
}

export async function cleanPetAction(petId: string): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.cleanPet({ petId });
    if (!res.ok) return { ok: false, message: `清洁失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: '已清洁' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('清洁', cleanPet(profile, petId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('清洁', error);
  }
}

export async function playWithPetAction(petId: string): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.playWithPet({ petId });
    if (!res.ok) return { ok: false, message: `陪玩失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: '已陪玩' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('陪玩', playWithPet(profile, petId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('陪玩', error);
  }
}

export async function upgradeHabitatAction(habitatId: string): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.upgradeHabitat({ habitatId });
    if (!res.ok) return { ok: false, message: `升级失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: '栖息地已升级' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('升级', upgradeHabitat(profile, habitatId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('升级', error);
  }
}

export async function movePetAction(petId: string, habitatId: string | null): Promise<ActionResult> {
  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.movePetToHabitat({ petId, habitatId });
    if (!res.ok) return { ok: false, message: `移动失败：${apiErrorText(res.error?.code)}` };
    await api.syncProfile();
    return { ok: true, message: habitatId === null ? '已移出栖息地' : '已放入栖息地' };
  }
  const profile = localProfile();
  if (!profile) return { ok: false, message: '没有存档' };
  try {
    return applyLocal('移动', movePetToHabitat(profile, petId, habitatId, nowMs(), getConfigRepo()));
  } catch (error) {
    return fail('移动', error);
  }
}
