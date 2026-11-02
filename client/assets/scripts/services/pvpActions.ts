import { applyProfilePatch } from '../../lib/core';
import type { Profile } from '../../lib/core';
import type {
  ApiErrorCode,
  FightPvpResponse,
  GetPvpDefenseResponse,
  GetPvpOpponentResponse,
  GetPvpReplayResponse,
  LeaderboardKind,
  LeaderboardResponse,
  PvpDefenseInfo,
  PvpOpponentSummary,
} from '../../lib/protocol';
import { appStore } from '../app/store';
import { takeSimulatedPvpFaultFor } from '../dev/devFaults';
import {
  MockPvpError,
  mockFight,
  mockGetDefense,
  mockGetOpponent,
  mockGetReplay,
  mockLeaderboard,
  mockSetDefense,
} from '../dev/mockPvp';
import type { MockPvpStorage } from '../dev/mockPvp';
import { getApiClient, getPlatformAdapter, nowMs } from './bootstrap';
import { getConfigRepo } from './config';
import { apiErrorText } from './errors';
import type { ActionResult } from './errors';

/**
 * PvP 动作（contract-v1.6 §7.5）：server 走 ROUTES，mock 走 dev/mockPvp。
 *
 * 所有写操作/请求都带去重 guard：同一动作在途时重复点击直接返回“请求处理中”，
 * 页面同时用 busy 态禁用按钮（M2-08）。409 的 latestProfile 重建由 ApiClient 统一处理。
 */
function isServerMode(): boolean {
  return appStore.getState().remote.mode === 'server';
}

function currentProfile(): Profile | null {
  return appStore.getState().profile;
}

function mockStorage(): MockPvpStorage {
  const adapter = getPlatformAdapter();
  return {
    get: <T>(key: string) => adapter.getStorage<T>(key),
    set: <T>(key: string, value: T) => adapter.setStorage(key, value),
  };
}

const pending = new Set<string>();

async function withGuard<T>(key: string, busyValue: T, run: () => Promise<T>): Promise<T> {
  if (pending.has(key)) return busyValue;
  pending.add(key);
  try {
    return await run();
  } finally {
    pending.delete(key);
  }
}

export interface PvpLoadResult<T> {
  ok: boolean;
  data?: T;
  message: string;
  code?: ApiErrorCode;
}

export interface PvpActionResult extends ActionResult {
  code?: ApiErrorCode;
}

function codeOf(error: unknown): ApiErrorCode {
  if (error instanceof MockPvpError) return error.code;
  return 'INTERNAL';
}

function failed(error: unknown, prefix: string): PvpLoadResult<never> {
  const code = codeOf(error);
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, code, message: `${prefix}：${apiErrorText(code)}（${detail}）` };
}

export async function loadPvpDefense(): Promise<PvpLoadResult<GetPvpDefenseResponse>> {
  return withGuard<PvpLoadResult<GetPvpDefenseResponse>>('pvp:defense:load', { ok: false, message: '请求处理中' }, async () => {
    const profile = currentProfile();
    if (!profile) return { ok: false, message: '没有存档' };

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.getPvpDefense();
      if (!res.ok || !res.data) {
        return { ok: false, code: res.error?.code, message: `加载防守失败：${apiErrorText(res.error?.code)}` };
      }
      return { ok: true, data: res.data, message: '已加载防守阵容' };
    }

    try {
      const data = await mockGetDefense(profile, mockStorage(), nowMs(), getConfigRepo());
      return { ok: true, data, message: data.defense ? '已加载防守阵容' : '尚未设置防守阵容' };
    } catch (error) {
      return failed(error, '加载防守失败');
    }
  });
}

export interface PvpDefenseSaveResult {
  ok: boolean;
  message: string;
  code?: ApiErrorCode;
  info?: PvpDefenseInfo;
}

export async function savePvpDefense(petIds: readonly string[]): Promise<PvpDefenseSaveResult> {
  return withGuard<PvpDefenseSaveResult>('pvp:defense:save', { ok: false, message: '请求处理中' }, async () => {
    const profile = currentProfile();
    if (!profile) return { ok: false, message: '没有存档' };

    const fault = await takeSimulatedPvpFaultFor(['PET_IN_USE', 'VALIDATION_FAILED']);
    if (fault === 'PET_IN_USE' || fault === 'VALIDATION_FAILED') {
      return { ok: false, code: fault, message: `设置防守失败：${apiErrorText(fault)}` };
    }

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.setPvpDefense({ petIds: [...petIds] });
      if (!res.ok || !res.data) {
        return { ok: false, code: res.error?.code, message: `设置防守失败：${apiErrorText(res.error?.code)}` };
      }
      appStore.setProfile(applyProfilePatch(profile, res.data.patch));
      const detail = await api.getPvpDefense();
      const info = detail.ok ? detail.data?.defense : undefined;
      appStore.setPvpOverview({ defense: info ?? null, error: null });
      return { ok: true, message: '防守阵容已保存（服务端）', info };
    }

    try {
      const result = await mockSetDefense(profile, petIds, mockStorage(), nowMs(), getConfigRepo());
      appStore.setProfile(result.profile);
      appStore.setPvpOverview({ defense: result.info, error: null });
      return { ok: true, message: '防守阵容已保存（离线演示）', info: result.info };
    } catch (error) {
      return {
        ok: false,
        code: codeOf(error),
        message: `设置防守失败：${error instanceof Error ? error.message : apiErrorText(codeOf(error))}`,
      };
    }
  });
}

export async function loadPvpOpponent(allowFault = true): Promise<PvpLoadResult<GetPvpOpponentResponse>> {
  return withGuard<PvpLoadResult<GetPvpOpponentResponse>>('pvp:opponent:load', { ok: false, message: '请求处理中' }, async () => {
    const profile = currentProfile();
    if (!profile) return { ok: false, message: '没有存档' };
    const fault = allowFault ? await takeSimulatedPvpFaultFor(['OPPONENT_UNAVAILABLE']) : null;
    if (fault === 'OPPONENT_UNAVAILABLE') {
      return { ok: false, code: fault, message: `匹配失败：${apiErrorText(fault)}` };
    }

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.getPvpOpponent();
      if (!res.ok || !res.data) {
        return { ok: false, code: res.error?.code, message: `匹配失败：${apiErrorText(res.error?.code)}` };
      }
      appStore.setPvpOpponent(res.data.opponent);
      return { ok: true, data: res.data, message: '已匹配到对手' };
    }

    try {
      const data = await mockGetOpponent(profile, mockStorage(), nowMs(), getConfigRepo());
      appStore.setPvpOpponent(data.opponent);
      return { ok: true, data, message: '已匹配到对手（离线演示）' };
    } catch (error) {
      return failed(error, '匹配失败');
    }
  });
}

export interface PvpFightResult extends PvpActionResult {
  data?: FightPvpResponse;
}

/** 一次挑战的幂等键：网络失败后从结果页重试时复用，避免重复扣次数。 */
let fightAttempt: { key: string; opponent: PvpOpponentSummary } | null = null;
let fightSequence = 0;

export async function fightPvp(
  opponent: PvpOpponentSummary,
  reuseIdempotencyKey?: string,
): Promise<PvpFightResult> {
  return withGuard<PvpFightResult>('pvp:fight', { ok: false, message: '请求处理中' }, async () => {
    const profile = currentProfile();
    if (!profile) return { ok: false, message: '没有存档' };

    const key = reuseIdempotencyKey ?? `pvp-fight-${nowMs().toString(36)}-${(fightSequence += 1)}`;
    fightAttempt = { key, opponent };

    const fault = await takeSimulatedPvpFaultFor([
      'DAILY_LIMIT_REACHED',
      'OPPONENT_UNAVAILABLE',
      'VALIDATION_FAILED',
    ]);
    if (fault === 'DAILY_LIMIT_REACHED' || fault === 'OPPONENT_UNAVAILABLE' || fault === 'VALIDATION_FAILED') {
      const failedResult: PvpFightResult = {
        ok: false,
        code: fault,
        message: `挑战失败：${apiErrorText(fault)}`,
      };
      appStore.setPvpError({ code: fault, message: failedResult.message });
      return failedResult;
    }

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.fightPvp({ opponentAccountId: opponent.accountId }, key);
      if (!res.ok || !res.data) {
        const code = res.error?.code;
        const message = `挑战失败：${apiErrorText(code)}`;
        appStore.setPvpError({ code, message });
        return { ok: false, code, message };
      }
      fightAttempt = null;
      appStore.setProfile(applyProfilePatch(profile, res.data.patch));
      appStore.setLastFight(res.data);
      appStore.setPvpOverview({
        challengesRemaining: res.data.challengesRemaining,
        seasonId: res.data.seasonId,
        error: null,
      });
      return { ok: true, message: '挑战完成', data: res.data };
    }

    try {
      const result = await mockFight(profile, opponent, mockStorage(), nowMs(), getConfigRepo());
      fightAttempt = null;
      appStore.setProfile(result.profile);
      appStore.setLastFight(result.response);
      appStore.setPvpOverview({
        challengesRemaining: result.response.challengesRemaining,
        seasonId: result.response.seasonId,
        error: null,
      });
      return { ok: true, message: '挑战完成（离线演示）', data: result.response };
    } catch (error) {
      const code = codeOf(error);
      const message = `挑战失败：${error instanceof Error ? error.message : apiErrorText(code)}`;
      appStore.setPvpError({ code, message });
      return { ok: false, code, message };
    }
  });
}

/** 网络/409 等失败后，用同一 Idempotency-Key 重试；服务端不会重复扣次数。 */
export async function retryLastFight(): Promise<PvpFightResult> {
  if (!fightAttempt) return { ok: false, message: '没有可重试的挑战' };
  if (!isServerMode()) return { ok: false, message: '离线模式请重新挑战' };
  return fightPvp(fightAttempt.opponent, fightAttempt.key);
}

export async function loadPvpReplay(replayId: string): Promise<PvpLoadResult<GetPvpReplayResponse>> {  return withGuard<PvpLoadResult<GetPvpReplayResponse>>('pvp:replay:load', { ok: false, message: '请求处理中' }, async () => {
    const fault = await takeSimulatedPvpFaultFor(['REPLAY_EXPIRED']);
    if (fault === 'REPLAY_EXPIRED') {
      return { ok: false, code: fault, message: `加载战报失败：${apiErrorText(fault)}` };
    }

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.getPvpReplay(replayId);
      if (!res.ok || !res.data) {
        return { ok: false, code: res.error?.code, message: `加载战报失败：${apiErrorText(res.error?.code)}` };
      }
      return { ok: true, data: res.data, message: '战报已加载' };
    }

    try {
      const data = await mockGetReplay(replayId, mockStorage(), nowMs());
      return { ok: true, data, message: '战报已加载（离线演示）' };
    } catch (error) {
      return failed(error, '加载战报失败');
    }
  });
}

export async function loadLeaderboard(kind: LeaderboardKind): Promise<PvpLoadResult<LeaderboardResponse>> {
  return withGuard<PvpLoadResult<LeaderboardResponse>>(`pvp:leaderboard:${kind}`, { ok: false, message: '请求处理中' }, async () => {
    const profile = currentProfile();
    if (!profile) return { ok: false, message: '没有存档' };

    if (isServerMode()) {
      const api = getApiClient();
      if (!api) return { ok: false, message: '服务端未连接' };
      const res = await api.getLeaderboard({ kind, limit: 20 });
      if (!res.ok || !res.data) {
        return { ok: false, code: res.error?.code, message: `加载排行榜失败：${apiErrorText(res.error?.code)}` };
      }
      return { ok: true, data: res.data, message: '排行榜已加载' };
    }

    try {
      const data = await mockLeaderboard(profile, kind, mockStorage(), nowMs(), 20);
      return { ok: true, data, message: '排行榜已加载（离线演示）' };
    } catch (error) {
      return failed(error, '加载排行榜失败');
    }
  });
}

/** Home PvP 入口：段位 + 剩余次数 + 防守状态。 */
export async function loadPvpOverview(): Promise<void> {
  const profile = currentProfile();
  if (!profile) return;
  appStore.setPvpOverview({ loading: true, error: null });

  const [defense, opponent] = await Promise.all([loadPvpDefense(), loadPvpOpponent(false)]);
  const error = !defense.ok && !opponent.ok ? defense.message || opponent.message : null;

  appStore.setPvpOverview({
    defense: defense.ok ? defense.data?.defense ?? null : appStore.getState().pvp.overview.defense,
    challengesRemaining: opponent.ok ? opponent.data?.challengesRemaining ?? null : null,
    dailyLimit: opponent.ok ? opponent.data?.dailyLimit ?? null : null,
    seasonId: opponent.ok ? opponent.data?.seasonId ?? null : appStore.getState().pvp.overview.seasonId,
    loading: false,
    error,
    loadedAt: nowMs(),
  });
}
