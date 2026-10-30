/**
 * PvE 奖励结算（contract-v1.5 E-02~E-06）。
 *
 * 纯函数：不推进时间、不写 revision。奖励档由调用方传入的 `firstClear` 与 `winner` 决定；
 * 首通宠物以**蛋阶段**直接进 `profile.pets`（不进 `breeding.eggs`）。
 */
import type { ConfigRepo, StageConfig } from './config/types.js';
import type { CreatePetInput, PveRewardContext, PveRewardResult, PveRewards } from './api.js';
import { TimeError } from './errors.js';
import { applyExp } from './exp.js';
import { createPetImpl } from './pet.js';
import { buildProfilePatch } from './profile-patch.js';
import type { EpochMs, ElementId, ResourceId } from './types/common.js';
import type { Genome, PetId, PetInstance } from './types/pet.js';
import type { CodexKey, Profile, ResourceBag } from './types/profile.js';

const REWARD_GENE = 50;

function codexKey(speciesId: string, elementId: string): CodexKey {
  return `${speciesId}:${elementId}`;
}

function rewardGenome(speciesId: string, elementId: ElementId): Genome {
  return {
    stats: { hp: REWARD_GENE, atk: REWARD_GENE, def: REWARD_GENE, spd: REWARD_GENE },
    speciesAlleles: [speciesId, speciesId],
    elementAlleles: [elementId, elementId],
    traitAlleles: [],
    mutationCount: 0,
  };
}

/** 确定性奖励蛋 id；被占用时追加序号（同一存档重复不应发生，防御性处理）。 */
function uniqueRewardId(pets: Profile['pets'], base: string): string {
  if (!pets[base]) return base;
  let suffix = 1;
  while (pets[`${base}_${suffix}`]) suffix += 1;
  return `${base}_${suffix}`;
}

export function applyPveRewardsImpl(
  profile: Profile,
  stage: StageConfig,
  ctx: PveRewardContext,
  now: EpochMs,
  cfg: ConfigRepo,
): PveRewardResult {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');

  const won = ctx.winner === 0;
  const firstClear = won && ctx.firstClear;

  const currencies = { ...profile.currencies };
  const pets: Profile['pets'] = { ...profile.pets };
  const codex = { ...profile.codex };
  const stageProgress = { ...profile.stageProgress };
  const stats = { ...profile.stats };
  const rewards: PveRewards = { firstClear };

  // 图鉴：敌方物种无论胜负都算“见过”（E-06）。
  for (const enemy of stage.enemies) {
    const key = codexKey(enemy.speciesId, enemy.elementId);
    const previous = codex[key];
    codex[key] = previous ? { ...previous, seen: true } : { seen: true, owned: false, bestGene: 0 };
  }

  if (won) {
    const tier = firstClear ? stage.rewards.firstClear : stage.rewards.repeat;

    if (tier?.resources !== undefined) {
      const granted: ResourceBag = { ...tier.resources };
      for (const [resource, amount] of Object.entries(granted) as Array<[ResourceId, number]>) {
        currencies[resource] = (currencies[resource] ?? 0) + amount;
      }
      rewards.resources = granted;
    }

    const petExp = tier?.petExp ?? 0;
    if (petExp > 0) {
      rewards.petExp = petExp;
      const seen = new Set<PetId>();
      for (const petId of ctx.partyPetIds) {
        if (seen.has(petId)) continue;
        seen.add(petId);
        const pet = pets[petId];
        // 已放生/缺失的队员跳过；蛋不参战，也不吃经验（E-04）。
        if (!pet || pet.stage === 'egg') continue;
        pets[petId] = applyExp(pet, petExp, cfg);
      }
    }

    if (firstClear && tier?.pets !== undefined && tier.pets.length > 0) {
      const grantedPets: PetInstance[] = [];
      tier.pets.forEach((spec, index) => {
        const id = uniqueRewardId(pets, `reward_${stage.id}_${index}`);
        const input: CreatePetInput = {
          id,
          speciesId: spec.speciesId,
          elementId: spec.elementId,
          genome: rewardGenome(spec.speciesId, spec.elementId),
          traits: [],
          hiddenTraits: [],
          gender: spec.gender ?? (index % 2 === 0 ? 'male' : 'female'),
          generation: 1,
          parents: [null, null],
          ancestors: [],
          level: 1,
          now,
        };
        const egg = createPetImpl(input, cfg);
        pets[egg.id] = egg;
        grantedPets.push(egg);

        const key = codexKey(egg.speciesId, egg.elementId);
        const previous = codex[key];
        codex[key] = {
          seen: true,
          owned: true,
          bestGene: Math.max(previous?.bestGene ?? 0, REWARD_GENE),
        };
      });
      rewards.pets = grantedPets;
    }

    const previous = stageProgress[stage.id];
    const bestTurns =
      previous?.bestTurns !== undefined
        ? Math.min(previous.bestTurns, ctx.turns)
        : ctx.turns;
    stageProgress[stage.id] = {
      cleared: true,
      bestTurns,
      ...(previous?.firstClearAt !== undefined
        ? { firstClearAt: previous.firstClearAt }
        : firstClear
          ? { firstClearAt: now }
          : {}),
    };
    stats.battlesWon += 1;
  } else {
    // 失败与平局都按失败计，不发奖励（E-03）。
    stats.battlesLost += 1;
  }

  const next: Profile = { ...profile, currencies, pets, codex, stageProgress, stats };
  return { profile: next, patch: buildProfilePatch(profile, next, now), rewards };
}
