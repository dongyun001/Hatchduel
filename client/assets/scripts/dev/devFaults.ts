import type { ApiErrorCode } from '../../lib/protocol';
import { getPlatform } from '../platform';

/**
 * 开发用故障注入（仅手动验收）：把 `petbattle.simulateBattleFault` 设为
 * BATTLE_EXPIRED / BATTLE_NOT_FOUND / VALIDATION_FAILED，下一次 PvE 结算会直接失败，
 * 用于验证「提示 + 重开」路径。读取后立即清除（一次性）。
 */
const STORAGE_KEY = 'petbattle.simulateBattleFault';

export type SimulatedBattleFault = 'BATTLE_EXPIRED' | 'BATTLE_NOT_FOUND' | 'VALIDATION_FAILED';

const ALLOWED: readonly SimulatedBattleFault[] = ['BATTLE_EXPIRED', 'BATTLE_NOT_FOUND', 'VALIDATION_FAILED'];

export async function takeSimulatedBattleFault(): Promise<ApiErrorCode | null> {
  try {
    const adapter = getPlatform();
    const value = await adapter.getStorage<unknown>(STORAGE_KEY);
    if (value === null || value === undefined) return null;
    await adapter.setStorage(STORAGE_KEY, null);
    return ALLOWED.includes(value as SimulatedBattleFault) ? (value as SimulatedBattleFault) : null;
  } catch {
    return null;
  }
}
