import type { ApiErrorCode } from '../../lib/protocol';
import { getPlatform } from '../platform';

/**
 * 开发用故障注入（仅手动验收；读取后立即清除，一次性）。
 *
 * - `petbattle.simulateBattleFault`：下一次 PvE 结算失败（BATTLE_EXPIRED / BATTLE_NOT_FOUND / VALIDATION_FAILED）。
 * - `petbattle.simulatePvpFault`：下一次 PvP 动作失败
 *   （DAILY_LIMIT_REACHED / OPPONENT_UNAVAILABLE / REPLAY_EXPIRED / PET_IN_USE / VALIDATION_FAILED）。
 *
 * 例：
 *   localStorage.setItem('petbattle.simulatePvpFault', JSON.stringify('DAILY_LIMIT_REACHED'));
 */
const BATTLE_FAULT_KEY = 'petbattle.simulateBattleFault';
const PVP_FAULT_KEY = 'petbattle.simulatePvpFault';

export type SimulatedBattleFault = 'BATTLE_EXPIRED' | 'BATTLE_NOT_FOUND' | 'VALIDATION_FAILED';

const ALLOWED_BATTLE: readonly SimulatedBattleFault[] = [
  'BATTLE_EXPIRED',
  'BATTLE_NOT_FOUND',
  'VALIDATION_FAILED',
];

export type SimulatedPvpFault =
  | 'DAILY_LIMIT_REACHED'
  | 'OPPONENT_UNAVAILABLE'
  | 'REPLAY_EXPIRED'
  | 'PET_IN_USE'
  | 'VALIDATION_FAILED';

const ALLOWED_PVP: readonly SimulatedPvpFault[] = [
  'DAILY_LIMIT_REACHED',
  'OPPONENT_UNAVAILABLE',
  'REPLAY_EXPIRED',
  'PET_IN_USE',
  'VALIDATION_FAILED',
];

async function takeFault<T extends string>(key: string, allowed: readonly T[]): Promise<T | null> {
  try {
    const adapter = getPlatform();
    const value = await adapter.getStorage<unknown>(key);
    if (value === null || value === undefined) return null;
    await adapter.setStorage(key, null);
    return allowed.includes(value as T) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function takeSimulatedBattleFault(): Promise<ApiErrorCode | null> {
  return takeFault(BATTLE_FAULT_KEY, ALLOWED_BATTLE);
}

export function takeSimulatedPvpFault(): Promise<SimulatedPvpFault | null> {
  return takeFault(PVP_FAULT_KEY, ALLOWED_PVP);
}

/**
 * 只消费“本次动作会用到”的 PvP 故障；不匹配时保留，供下一个动作消费。
 * 这样 Home 概览的后台加载不会把玩家给「保存防守」设置的 PET_IN_USE 吃掉。
 */
export async function takeSimulatedPvpFaultFor(
  allowed: readonly SimulatedPvpFault[],
): Promise<SimulatedPvpFault | null> {
  try {
    const adapter = getPlatform();
    const value = await adapter.getStorage<unknown>(PVP_FAULT_KEY);
    if (value === null || value === undefined) return null;
    if (!ALLOWED_PVP.includes(value as SimulatedPvpFault)) {
      await adapter.setStorage(PVP_FAULT_KEY, null);
      return null;
    }
    const fault = value as SimulatedPvpFault;
    if (!allowed.includes(fault)) return null;
    await adapter.setStorage(PVP_FAULT_KEY, null);
    return fault;
  } catch {
    return null;
  }
}

export const DEV_FAULT_KEYS = {
  battle: BATTLE_FAULT_KEY,
  pvp: PVP_FAULT_KEY,
} as const;
