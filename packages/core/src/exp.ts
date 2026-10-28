import { EXP_BASE, EXP_PER_LEVEL } from './constants.js';

/**
 * 升级所需经验：`40 + level × 20`（初版，待 sim 验证）。
 *
 * 升级规则（A 实现）：`while (exp >= expToNext(level) && level < 20) { exp -= ...; level++ }`，
 * 升级后重新计算派生属性。
 */
export function expToNext(level: number): number {
  return EXP_BASE + level * EXP_PER_LEVEL;
}
