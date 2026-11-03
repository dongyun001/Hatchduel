import { applyProfilePatch, applyPveRewards, buildPveBattleSetup, runBattle } from '../../lib/core';
import type { BattleSetup, Command, PetInstance, PveRewards, Profile, StageConfig } from '../../lib/core';
import { appStore } from '../app/store';
import { takeSimulatedBattleFault, takeSimulatedPvpFaultFor } from '../dev/devFaults';
import type { BattleSessionState } from '../app/store';
import { getApiClient, nowMs } from './bootstrap';
import { getConfigRepo } from './config';
import { apiErrorText, errorMessage } from './errors';
import type { ActionResult } from './errors';

/**
 * PvE 开战/结算：服务端模式走 `/battle/pve/*`，离线模式用 core 的
 * `buildPveBattleSetup` + `runBattle` + `applyPveRewards`，两条路径共用同一套 UI。
 */
export interface BattleStartResult extends ActionResult {
  started: boolean;
}

export interface BattleClaimResult extends ActionResult {
  winner?: 0 | 1 | null;
  rewards?: PveRewards;
  /** 会话失效/重放失败/版本冲突：UI 应提示重开，而不是原地重试。 */
  restart?: boolean;
}

const RESOURCE_NAMES: Record<string, string> = {
  coin: '金币',
  food: '食物',
  geneDust: '基因尘',
  premium: '钻石',
};

function isServerMode(): boolean {
  return appStore.getState().remote.mode === 'server';
}

function profileOrNull(): Profile | null {
  return appStore.getState().profile;
}

/** 可出战宠物：非蛋，按等级降序；lineup 里的优先。 */
export function eligibleParty(profile: Profile): PetInstance[] {
  const all = Object.values(profile.pets).filter((pet) => pet.stage !== 'egg');
  const byId = new Map(all.map((pet) => [pet.id, pet]));
  const picked: PetInstance[] = [];
  for (const id of profile.lineup) {
    const pet = byId.get(id);
    if (pet && !picked.includes(pet)) picked.push(pet);
  }
  for (const pet of all.sort((a, b) => b.level - a.level)) {
    if (picked.length >= 3) break;
    if (!picked.includes(pet)) picked.push(pet);
  }
  return picked.slice(0, 3);
}

/** 保存编队：服务端走 `/lineup/set`；离线只写 profile.lineup（不重算属性）。 */
export async function saveLineup(petIds: readonly string[]): Promise<ActionResult> {
  const profile = profileOrNull();
  if (!profile) return { ok: false, message: '没有存档' };
  const fault = await takeSimulatedPvpFaultFor(['PET_IN_USE', 'VALIDATION_FAILED']);
  if (fault) return { ok: false, message: `保存编队失败：${apiErrorText(fault)}` };
  if (petIds.length === 0 || petIds.length > 3) return { ok: false, message: '编队需要 1~3 只宠物' };
  for (const id of petIds) {
    const pet = profile.pets[id];
    if (!pet) return { ok: false, message: '编队里有不存在的宠物' };
    if (pet.stage === 'egg') return { ok: false, message: '蛋不能上阵' };
  }

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, message: '服务端未连接' };
    const res = await api.setLineup({ petIds: [...petIds] });
    if (!res.ok || !res.data) return { ok: false, message: `保存编队失败：${apiErrorText(res.error?.code)}` };
    appStore.setProfile(applyProfilePatch(profile, res.data.patch));
    return { ok: true, message: '编队已保存（服务端）' };
  }

  appStore.setProfile({ ...profile, lineup: [...petIds] });
  return { ok: true, message: '编队已保存（离线演示）' };
}

/** 开战：准备会话并写入 store；调用方随后切到 Battle 场景。 */
export async function startBattle(stageId: string, selectedPetIds?: readonly string[]): Promise<BattleStartResult> {
  const profile = profileOrNull();
  if (!profile) return { ok: false, started: false, message: '没有存档' };
  const cfg = getConfigRepo();
  const stage = cfg.stage(stageId);

  if (isServerMode()) {
    const api = getApiClient();
    if (!api) return { ok: false, started: false, message: '服务端未连接' };

    const selected = selectedPetIds && selectedPetIds.length > 0 ? [...selectedPetIds] : eligibleParty(profile).map((pet) => pet.id);
    if (selected.length === 0) return { ok: false, started: false, message: '没有可出战的宠物' };
    const sameLineup =
      selected.length === profile.lineup.length && selected.every((id, index) => profile.lineup[index] === id);
    if (!sameLineup) {
      const saved = await saveLineup(selected);
      if (!saved.ok) return { ok: false, started: false, message: saved.message };
    }

    const res = await api.startPveBattle({ stageId });
    if (!res.ok || !res.data) {
      return { ok: false, started: false, message: `开战失败：${apiErrorText(res.error?.code)}` };
    }
    const session: BattleSessionState = {
      mode: 'server',
      battleId: res.data.battleId,
      stageId,
      setup: res.data.setup,
      expiresAt: res.data.expiresAt,
      partyPetIds: res.data.setup.teams[0].map((unit) => unit.petId),
    };
    appStore.setBattle(session);
    return { ok: true, started: true, message: '战斗开始（服务端会话）' };
  }

  const selected = selectedPetIds && selectedPetIds.length > 0 ? [...selectedPetIds] : eligibleParty(profile).map((pet) => pet.id);
  const party = pickParty(profile, selected);
  if (party.length === 0) return { ok: false, started: false, message: '没有可出战的宠物' };
  const saved = await saveLineup(party.map((pet) => pet.id));
  if (!saved.ok) return { ok: false, started: false, message: saved.message };
  const seed = (nowMs() >>> 0) || 1;
  const setup: BattleSetup = buildPveBattleSetup(party, stage, cfg, seed);
  const session: BattleSessionState = {
    mode: 'mock',
    battleId: null,
    stageId,
    setup,
    expiresAt: null,
    partyPetIds: setup.teams[0].map((unit) => unit.petId),
  };
  appStore.setBattle(session);
  return { ok: true, started: true, message: '战斗开始（离线演示）' };
}

function pickParty(profile: Profile, selectedPetIds?: readonly string[]): PetInstance[] {
  if (!selectedPetIds || selectedPetIds.length === 0) return eligibleParty(profile);
  return selectedPetIds
    .map((id) => profile.pets[id])
    .filter((pet): pet is PetInstance => Boolean(pet && pet.stage !== 'egg'))
    .slice(0, 3);
}

/** 结算：服务端提交完整指令序列并应用 patch；离线用同一 setup 重放并结算奖励。 */
export async function claimBattle(commands: readonly Command[]): Promise<BattleClaimResult> {
  const session = appStore.getState().battle;
  const profile = profileOrNull();
  if (!session || !profile) return { ok: false, message: '没有进行中的战斗' };

  // 开发验收：本地存储注入一次性故障，验证「提示 + 重开」路径。
  const fault = await takeSimulatedBattleFault();
  if (fault) {
    return { ok: false, message: `结算失败：${apiErrorText(fault)}`, restart: true };
  }

  if (session.mode === 'server') {
    const api = getApiClient();
    if (!api || !session.battleId) return { ok: false, message: '服务端会话缺失' };
    const res = await api.claimPveBattle({ battleId: session.battleId, commands: [...commands] });
    if (!res.ok || !res.data) {
      const code = res.error?.code;
      const message =
        code === 'REVISION_CONFLICT'
          ? '存档已在别处更新，已刷新到最新档，请重开战斗'
          : `结算失败：${apiErrorText(code)}`;
      const restart =
        code === 'REVISION_CONFLICT' ||
        code === 'BATTLE_EXPIRED' ||
        code === 'BATTLE_NOT_FOUND' ||
        code === 'VALIDATION_FAILED';
      return { ok: false, message, restart };
    }
    const data = res.data;
    appStore.setProfile(applyProfilePatch(profile, data.patch));
    appStore.setBattle(null);
    return {
      ok: true,
      message: winnerText(data.winner),
      winner: data.winner,
      rewards: data.rewards,
    };
  }

  const cfg = getConfigRepo();
  const stage: StageConfig = cfg.stage(session.stageId);
  let replay: ReturnType<typeof runBattle>;
  try {
    replay = runBattle(session.setup, cfg, commands);
  } catch (error) {
    return { ok: false, message: `战斗重放失败：${errorMessage(error)}`, restart: true };
  }
  const firstClear = !profile.stageProgress[session.stageId]?.cleared;
  const result = applyPveRewards(
    profile,
    stage,
    { firstClear, winner: replay.winner, partyPetIds: session.partyPetIds, turns: replay.turns },
    nowMs(),
    cfg,
  );
  appStore.setProfile(result.profile);
  appStore.setBattle(null);
  return { ok: true, message: winnerText(replay.winner), winner: replay.winner, rewards: result.rewards };
}

export function winnerText(winner: 0 | 1 | null): string {
  if (winner === 0) return '胜利';
  if (winner === 1) return '失败';
  return '平局';
}

/** 奖励摘要，给结算面板用。 */
export function describeRewards(rewards: PveRewards | undefined): string {
  if (!rewards) return '无奖励数据';
  const parts: string[] = [];
  if (rewards.resources) {
    for (const [resource, amount] of Object.entries(rewards.resources)) {
      if (amount !== undefined) parts.push(`${RESOURCE_NAMES[resource] ?? resource} +${amount}`);
    }
  }
  if (rewards.petExp) parts.push(`经验 +${rewards.petExp}`);
  if (rewards.pets && rewards.pets.length > 0) parts.push(`新宠物 ×${rewards.pets.length}`);
  if (parts.length === 0) parts.push('无奖励');
  return `${rewards.firstClear ? '首通' : '重复'}：${parts.join(' · ')}`;
}
