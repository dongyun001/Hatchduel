/**
 * 异步 PvP 的 core 辅助（contract-v1.6 F-09）。
 *
 * - `buildDefenseSnapshot`：把本人宠物定格成防守快照（uid `d0/d1/d2`），属性/技能/特质/被动
 *   与 `buildBattleSetup` 同口径；不写存档、不读时钟。
 * - `buildPvpBattleSetup`：攻方个体 + 防守快照 → `BattleSetup`；team0 = `a*`、team1 = `b*`，
 *   不改入参数组。
 * - `applyPvpOutcome`：只改 `pvp` / `stats`，不推进时间；Elo 由服务端计算，core 不实现。
 */
import { buildBattleSetupImpl } from './battle/setup.js';
import type { ConfigRepo } from './config/types.js';
import { DEFENSE_SNAPSHOT_TTL_MS, MAX_LINEUP_SIZE } from './constants.js';
import { DefenseError } from './errors.js';
import { buildProfilePatch } from './profile-patch.js';
import { deriveStatsImpl } from './stats.js';
import type { DefenseSnapshot, PvpOutcome, PvpOutcomeResult } from './api.js';
import type { BattleSetup, BattleUnitInit } from './types/battle.js';
import type { EpochMs } from './types/common.js';
import type { PetId, PetInstance } from './types/pet.js';
import type { Profile, PvpState } from './types/profile.js';

/** 校验顺序与契约一致：数量 → 重复 → 存在 → 非蛋（F-01）。 */
function collectDefensePets(profile: Profile, petIds: readonly PetId[]): PetInstance[] {
  if (petIds.length < 1 || petIds.length > MAX_LINEUP_SIZE) {
    throw new DefenseError('invalid_count');
  }

  const seen = new Set<PetId>();
  for (const petId of petIds) {
    if (seen.has(petId)) throw new DefenseError('duplicate');
    seen.add(petId);
  }

  const pets: PetInstance[] = [];
  for (const petId of petIds) {
    const pet = profile.pets[petId];
    if (!pet) throw new DefenseError('pet_not_found');
    if (pet.stage === 'egg') throw new DefenseError('pet_is_egg');
    pets.push(pet);
  }
  return pets;
}

export function buildDefenseSnapshotImpl(
  profile: Profile,
  petIds: readonly PetId[],
  now: EpochMs,
  cfg: ConfigRepo,
): DefenseSnapshot {
  const pets = collectDefensePets(profile, petIds);

  const units = pets.map((pet, slot) => {
    const species = cfg.species(pet.speciesId);
    return {
      uid: `d${slot}`,
      petId: pet.id,
      speciesId: pet.speciesId,
      elementId: pet.elementId,
      level: pet.level,
      stats: deriveStatsImpl(pet, cfg),
      skills: cfg.skillsFor(pet),
      traits: [...pet.traits],
      ...(species.passiveId ? { passiveId: species.passiveId } : {}),
    } satisfies BattleUnitInit;
  });

  return {
    petIds: [...petIds],
    units,
    contentVersion: cfg.contentVersion,
    createdAt: now,
    expiresAt: now + DEFENSE_SNAPSHOT_TTL_MS,
  };
}

function assertPvpTeamSize(size: number, label: string): void {
  if (size < 1 || size > MAX_LINEUP_SIZE) {
    throw new Error(
      `@petbattle/core: ${label}必须为 1~${MAX_LINEUP_SIZE} 只，收到 ${size}（contract-v1.6 F-09）`,
    );
  }
}

export function buildPvpBattleSetupImpl(
  attackerPets: readonly PetInstance[],
  defenseUnits: readonly BattleUnitInit[],
  cfg: ConfigRepo,
  seed: number,
): BattleSetup {
  assertPvpTeamSize(attackerPets.length, 'PvP 攻方队伍');
  assertPvpTeamSize(defenseUnits.length, 'PvP 防守阵容');

  const attackers = buildBattleSetupImpl([attackerPets, []], cfg, seed).teams[0];

  // 防守单位来自快照（uid 为 d*），进战斗前重排为 b*；复制属性容器，避免与存储快照共享引用。
  const defenders = defenseUnits.map((unit, slot) => ({
    ...unit,
    uid: `b${slot}`,
    stats: { ...unit.stats },
    skills: [...unit.skills],
    traits: [...unit.traits],
  }));

  return { seed, teams: [attackers, defenders] };
}

function nextRanked(
  pvp: PvpState,
  result: PvpOutcome['result'],
  rankedMatch: boolean,
): PvpState['ranked'] {
  if (!rankedMatch) {
    return pvp.ranked !== undefined ? { ...pvp.ranked } : undefined;
  }
  return {
    wins: (pvp.ranked?.wins ?? 0) + (result === 'win' ? 1 : 0),
    losses: (pvp.ranked?.losses ?? 0) + (result === 'loss' ? 1 : 0),
    draws: (pvp.ranked?.draws ?? 0) + (result === 'draw' ? 1 : 0),
  };
}

export function applyPvpOutcomeImpl(profile: Profile, outcome: PvpOutcome): PvpOutcomeResult {
  // 非排位（机器人）对局不允许改 rating；显式拒绝而不是静默忽略，便于服务端早失败。
  if (!outcome.ranked && outcome.ratingAfter !== profile.pvp.rating) {
    throw new Error(
      '@petbattle/core: 非排位对局的 ratingAfter 必须等于当前 rating（contract-v1.6 F-09）',
    );
  }

  const ranked = nextRanked(profile.pvp, outcome.result, outcome.ranked);
  const pvp: PvpState = {
    defense: [...profile.pvp.defense],
    rating: outcome.ranked ? outcome.ratingAfter : profile.pvp.rating,
    seasonId: outcome.seasonId,
    ...(ranked !== undefined ? { ranked } : {}),
  };

  const stats = {
    ...profile.stats,
    battlesWon: profile.stats.battlesWon + (outcome.result === 'win' ? 1 : 0),
    battlesLost: profile.stats.battlesLost + (outcome.result === 'loss' ? 1 : 0),
  };

  const next: Profile = { ...profile, pvp, stats };
  // 无 now 参数：patch.at 取存档当前时间点；不推进 lastEvaluatedAt。
  return { profile: next, patch: buildProfilePatch(profile, next, profile.lastEvaluatedAt) };
}
