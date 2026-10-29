// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
import { EXP_BASE, EXP_PER_LEVEL, MAX_LEVEL } from './constants';
import type { ConfigRepo } from './config/types';
import type { PetInstance } from './types/pet';

/**
 * 升级所需经验：`40 + level × 20`（初版，待 sim 验证）。
 *
 * 升级规则（A 实现）：`while (exp >= expToNext(level) && level < 20) { exp -= ...; level++ }`，
 * 升级后重新计算派生属性。
 */
export function expToNext(level: number): number {
  return EXP_BASE + level * EXP_PER_LEVEL;
}

/**
 * 加经验并结算升级（contract-v1.2 D-07）。
 *
 * - `exp += amount`；`while (level < 20 && exp >= expToNext(level)) { exp -= expToNext(level); level++ }`；
 * - 满级（20）后不再升级，多余经验保留在 `exp`（便于后续展示/统计）；
 * - `amount <= 0` 或非有限数时原样返回（返回新对象，不修改入参）；
 * - 只处理个体等级/经验，不碰 `stageProgress`、首通奖励（服务端结算）。
 *
 * `cfg` 为契约签名保留位（升级曲线目前在 `constants.ts` 冻结）；不读它。
 */
export function applyExp(pet: PetInstance, amount: number, cfg: ConfigRepo): PetInstance {
  void cfg;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ...pet };
  }

  let level = pet.level;
  let exp = pet.exp + amount;
  while (level < MAX_LEVEL && exp >= expToNext(level)) {
    exp -= expToNext(level);
    level += 1;
  }

  return { ...pet, level, exp };
}
