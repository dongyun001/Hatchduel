/**
 * PvP 纯规则（CONTRACT §7.5 F-02/F-04/F-05）。
 *
 * 这里只有不依赖存储/网络的计算：换季软重置、Elo、Asia/Shanghai 切日、
 * 排行榜取值。服务端其他层只调用这些函数，不各自复制一份公式。
 */
import type { LeaderboardKind } from '@petbattle/protocol';
import type { Profile, PvpState } from '@petbattle/core';

import type { PvpSettings } from '../config.js';

export type PvpResult = 'win' | 'loss' | 'draw';

/** Asia/Shanghai = UTC+8，无夏令时；不需要 Intl/时区库。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 每日挑战按上海本地 00:00 切日。 */
export function shanghaiDayKey(now: number): string {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export interface SeasonRollover {
  profile: Profile;
  changed: boolean;
}

/**
 * 换季软重置（F-04）：`rating = round((rating + 1000) / 2)`，并写入当前赛季。
 * M2 不做定时器，在读写档发现 seasonId 不一致时惰性触发一次。
 */
export function rolloverSeason(profile: Profile, settings: PvpSettings): SeasonRollover {
  if (profile.pvp.seasonId === settings.seasonId) {
    return { profile, changed: false };
  }
  const pvp: PvpState = {
    ...profile.pvp,
    rating: Math.round((profile.pvp.rating + settings.initialRating) / 2),
    seasonId: settings.seasonId,
  };
  return { profile: { ...profile, pvp }, changed: true };
}

/**
 * Elo（F-04）：`Ea = 1 / (1 + 10^((Rb - Ra) / 400))`；
 * K 按**攻方结果**取 32/24/16；`delta = round(K × (S − Ea))`，攻方 +delta、防守方 −delta。
 */
export function eloDelta(
  attackerRating: number,
  defenderRating: number,
  result: PvpResult,
  settings: PvpSettings,
): number {
  const expected = 1 / (1 + 10 ** ((defenderRating - attackerRating) / 400));
  const score = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5;
  const k = result === 'win' ? settings.kWin : result === 'loss' ? settings.kLoss : settings.kDraw;
  return Math.round(k * (score - expected));
}

/** 防守方结果 = 攻方结果取反（平局不变）。 */
export function invertResult(result: PvpResult): PvpResult {
  if (result === 'win') return 'loss';
  if (result === 'loss') return 'win';
  return 'draw';
}

export function averageLevel(levels: readonly number[]): number {
  if (levels.length === 0) return 1;
  let sum = 0;
  for (const level of levels) sum += level;
  return sum / levels.length;
}

/** 真人排位场次；旧档缺省 `ranked` 视为 0。 */
export function rankedGames(pvp: PvpState): number {
  return (pvp.ranked?.wins ?? 0) + (pvp.ranked?.losses ?? 0) + (pvp.ranked?.draws ?? 0);
}

export interface LeaderboardValue {
  eligible: boolean;
  value: number;
}

/**
 * 四榜取值（F-05）：
 * - `rating`：当前赛季 rating；至少 1 场真人排位才有资格；
 * - `codex`：`owned=true` 条目数；
 * - `gene`：非蛋宠物四项基因均值的最大值；
 * - `generation`：非蛋宠物 generation 的最大值。
 */
export function leaderboardValue(kind: LeaderboardKind, profile: Profile): LeaderboardValue {
  switch (kind) {
    case 'rating': {
      const eligible = rankedGames(profile.pvp) >= 1;
      return { eligible, value: profile.pvp.rating };
    }
    case 'codex': {
      const value = Object.values(profile.codex).filter((entry) => entry.owned).length;
      return { eligible: value >= 1, value };
    }
    case 'gene': {
      let best = -1;
      for (const pet of Object.values(profile.pets)) {
        if (pet.stage === 'egg') continue;
        const stats = pet.genome.stats;
        const value = Math.floor((stats.hp + stats.atk + stats.def + stats.spd) / 4);
        if (value > best) best = value;
      }
      return { eligible: best >= 0, value: Math.max(0, best) };
    }
    case 'generation': {
      let best = 0;
      for (const pet of Object.values(profile.pets)) {
        if (pet.stage === 'egg') continue;
        if (pet.generation > best) best = pet.generation;
      }
      return { eligible: best >= 1, value: best };
    }
  }
}
