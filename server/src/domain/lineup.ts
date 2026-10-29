/**
 * 出战编队校验（ONLINE_DESIGN §5.2）。
 *
 * 这里只做**接口层校验**（最多 3 只、属于本人、引用存在、非蛋、不重复），
 * 战斗时的属性系数（幼年 70% 等）由 `core.deriveStats` 在建战时计算，编队接口不碰数值。
 *
 * 编队与 PvP 防守阵容（`profile.pvp.defense`）是两个独立系统，互不联动。
 */
import { MAX_LINEUP_SIZE } from '@petbattle/core';
import type { PetId, Profile } from '@petbattle/core';

import { AppError } from '../errors.js';

export function validateLineup(profile: Profile, input: unknown): PetId[] {
  if (!Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', 'petIds 必须是数组');
  }
  if (input.length > MAX_LINEUP_SIZE) {
    throw new AppError('INVALID_LINEUP', `出战编队最多 ${MAX_LINEUP_SIZE} 只，收到 ${input.length}`);
  }

  const seen = new Set<string>();
  const lineup: PetId[] = [];

  for (const raw of input as unknown[]) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'petIds 只能包含非空字符串');
    }
    if (seen.has(raw)) {
      throw new AppError('INVALID_LINEUP', `出战编队不能重复同一只宠物：${raw}`);
    }
    seen.add(raw);

    const pet = profile.pets[raw];
    if (pet === undefined) {
      throw new AppError('INVALID_LINEUP', `出战编队引用了不存在的宠物：${raw}`);
    }
    if (pet.stage === 'egg') {
      throw new AppError('INVALID_LINEUP', `蛋不能上阵：${raw}`);
    }
    // 幼年可以上阵：属性由 deriveStats 按阶段系数计算。
    lineup.push(raw);
  }

  return lineup;
}
