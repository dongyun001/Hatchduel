/**
 * 出战编队校验（ONLINE_DESIGN §5.2）。
 *
 * 这里只做**接口层校验**（最多 3 只、属于本人、引用存在、非蛋、不重复），
 * 战斗时的属性系数（幼年 70% 等）由 `core.deriveStats` 在建战时计算，编队接口不碰数值。
 *
 * 编队与 PvP 防守阵容（`profile.pvp.defense`）是两个独立系统，互不联动。
 */
import { MAX_LINEUP_SIZE } from '@petbattle/core';
import type { PetId, PetInstance, Profile } from '@petbattle/core';

import { AppError } from '../errors.js';

export function validateLineup(profile: Profile, input: unknown): PetId[] {
  if (!Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', 'petIds 必须是数组');
  }
  if (input.length > MAX_LINEUP_SIZE) {
    throw new AppError(
      'INVALID_LINEUP',
      `出战编队最多 ${MAX_LINEUP_SIZE} 只，收到 ${input.length}`,
    );
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

/**
 * 出战编队 → 参战个体：1~3 只、存在、非蛋、不重复（CONTRACT §7.4 E-01 / §7.5 F-03）。
 * PvE 与 PvP 攻方共用同一口径，避免两处校验漂移。
 */
export function partyFromLineup(profile: Profile): PetInstance[] {
  const lineup = profile.lineup;
  if (lineup.length === 0) {
    throw new AppError('INVALID_LINEUP', '出战编队为空，请先设置编队');
  }
  if (lineup.length > MAX_LINEUP_SIZE) {
    throw new AppError('INVALID_LINEUP', `出战编队最多 ${MAX_LINEUP_SIZE} 只`);
  }

  const seen = new Set<string>();
  const party: PetInstance[] = [];
  for (const petId of lineup) {
    if (seen.has(petId)) throw new AppError('INVALID_LINEUP', `编队重复：${petId}`);
    seen.add(petId);

    const pet = profile.pets[petId];
    if (pet === undefined) throw new AppError('INVALID_LINEUP', `编队引用了不存在的宠物：${petId}`);
    if (pet.stage === 'egg') throw new AppError('INVALID_LINEUP', `蛋不能参战：${petId}`);
    party.push(pet);
  }
  return party;
}
