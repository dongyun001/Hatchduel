// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * 时间推进（DOMAIN_MODEL §5/§6/§7，AGENTS §3.4）。
 *
 * 顺序固定：阶段 → 状态 → 冷却 → 栖息地产出，不允许交换（PITFALLS P-031）。
 * - 产出用 `offlineCapMs`（默认 8h）封顶；状态衰减用 `decayCapMs`（默认 24h）封顶（P-025）。
 * - `now` 倒退抛 `TimeError('time_backwards')`；同一 `now` 重复调用不产生额外变化。
 * - 产出按 `dtHours` 线性插值（不截断到整小时），每个资源单独 `floor`；
 *   宠物数为 0 时产出 0，不做除法。
 */
import { HEALTH_FLOOR } from './constants';
import type { ConfigRepo, HabitatConfig } from './config/types';
import { TimeError } from './errors';
import type { PetInstance, Stage } from './types/pet';
import type { HabitatInstance, Profile, ProfilePatch, ResourceBag } from './types/profile';
import type { EpochMs, ResourceId } from './types/common';

const MS_PER_HOUR = 3_600_000;

/** 产出系数的默认值（DOMAIN §6.1）；配置了 `productionStageMul` 时以配置为准（D-06）。 */
const DEFAULT_PRODUCTION_STAGE_MUL: Record<Exclude<Stage, 'egg'>, number> = {
  juvenile: 0.5,
  adult: 1,
  elder: 0.8,
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampMs(value: number, cap: number): number {
  return clamp(value, 0, cap);
}

function addAmount(bag: ResourceBag, resource: ResourceId, amount: number): void {
  bag[resource] = (bag[resource] ?? 0) + amount;
}

function habitatLevelConfig(config: HabitatConfig, level: number): HabitatConfig['upgrade']['levels'][number] {
  const levels = config.upgrade.levels;
  const found = levels.find((entry) => entry.level === level);
  if (found) return found;
  const fallback = levels[levels.length - 1];
  if (!fallback) {
    throw new Error(`@petbattle/core: 栖息地 "${config.id}" 没有任何升级等级`);
  }
  return fallback;
}

/** 按 `decayCapMs` 结算状态衰减；蛋不衰减、不消耗。 */
function decayCondition(
  pet: PetInstance,
  config: HabitatConfig,
  dtMs: number,
): PetInstance['condition'] {
  const dtHours = clampMs(dtMs, config.decayCapMs) / MS_PER_HOUR;
  if (dtHours <= 0) return pet.condition;

  const decay = config.conditionDecayPerHour;
  const hunger = clamp(pet.condition.hunger - decay.hunger * dtHours, 0, 100);
  const mood = clamp(pet.condition.mood - decay.mood * dtHours, 0, 100);
  const hygiene = clamp(pet.condition.hygiene - decay.hygiene * dtHours, 0, 100);

  let health = pet.condition.health;
  if (hunger <= 0 || hygiene <= 0) {
    health -= config.healthDecayWhenStarving * dtHours;
  } else if (hunger >= 50 && hygiene >= 50) {
    health += config.healthRecoveryPerHour * dtHours;
  }

  return {
    hunger,
    mood,
    hygiene,
    health: clamp(health, HEALTH_FLOOR, 100),
  };
}

export interface AdvancePetResultImpl {
  pet: PetInstance;
  changed: boolean;
}

export function advancePetImpl(
  pet: PetInstance,
  now: EpochMs,
  cfg: ConfigRepo,
): AdvancePetResultImpl {
  if (now < pet.updatedAt) throw new TimeError('time_backwards');

  const breeding = cfg.breeding();
  let stage = pet.stage;
  let stageChangedAt = pet.stageChangedAt;

  // 长时间离线可能跨多个阶段；循环到不能再推进为止。
  for (;;) {
    if (stage === 'egg') {
      const threshold = pet.bornAt + breeding.hatchMs;
      if (now < threshold) break;
      stage = 'juvenile';
      stageChangedAt = threshold;
      continue;
    }
    if (stage === 'juvenile') {
      const threshold = stageChangedAt + breeding.juvenileMs;
      if (now < threshold) break;
      stage = 'adult';
      stageChangedAt = threshold;
      continue;
    }
    if (stage === 'adult') {
      const threshold = stageChangedAt + breeding.elderAfterMs;
      if (now < threshold) break;
      stage = 'elder';
      stageChangedAt = threshold;
      continue;
    }
    break;
  }

  const stageChanged = stage !== pet.stage;
  const timeChanged = now !== pet.updatedAt;

  return {
    pet: {
      ...pet,
      stage,
      stageChangedAt,
      updatedAt: now,
    },
    changed: stageChanged || timeChanged,
  };
}

export interface AdvanceHabitatResultImpl {
  habitat: HabitatInstance;
  produced: ResourceBag;
  /** 每小时消耗合计后无法覆盖的缺口（food 缺口会触发可选饥饿惩罚，D-05）。 */
  upkeepShortfall: ResourceBag;
}

export function advanceHabitatImpl(
  habitat: HabitatInstance,
  pets: readonly PetInstance[],
  now: EpochMs,
  cfg: ConfigRepo,
): AdvanceHabitatResultImpl {
  if (now < habitat.lastEvaluatedAt) throw new TimeError('time_backwards');

  const config = cfg.habitat(habitat.configId);
  const dtMs = clampMs(now - habitat.lastEvaluatedAt, config.offlineCapMs);
  const dtHours = dtMs / MS_PER_HOUR;

  const active = pets.filter((pet) => pet.stage !== 'egg');
  const produced: ResourceBag = {};
  const stageMuls = config.productionStageMul ?? DEFAULT_PRODUCTION_STAGE_MUL;

  if (active.length > 0 && dtHours > 0) {
    let elementMul = 1;
    let moodSum = 0;
    let stageMulSum = 0;
    for (const pet of active) {
      elementMul += config.elementBonus[pet.elementId] ?? 0;
      moodSum += pet.condition.mood;
      if (pet.stage !== 'egg') stageMulSum += stageMuls[pet.stage];
    }
    const stageMul = stageMulSum / active.length;
    const moodMul = 0.8 + (moodSum / active.length / 100) * 0.2;
    const levelMul = habitatLevelConfig(config, habitat.level).productionMul;

    for (const rate of config.productionPerHour) {
      const amount = Math.floor(
        rate.amountPerHour * elementMul * stageMul * moodMul * levelMul * dtHours,
      );
      if (amount > 0) addAmount(produced, rate.resource, amount);
    }
  }

  const stored: ResourceBag = { ...habitat.stored };
  for (const [resource, amount] of Object.entries(produced) as Array<[ResourceId, number]>) {
    addAmount(stored, resource, amount);
  }

  const upkeepShortfall: ResourceBag = {};
  for (const rate of config.upkeepPerPetPerHour) {
    const need = rate.amountPerHour * active.length * dtHours;
    if (need <= 0) continue;
    const have = stored[rate.resource] ?? 0;
    const paid = Math.min(have, need);
    stored[rate.resource] = have - paid;
    const shortfall = need - paid;
    if (shortfall > 0) addAmount(upkeepShortfall, rate.resource, shortfall);
  }

  // 食物不足 → 饥饿惩罚（D-05）。只按“有无缺口”判定，不按缺口大小缩放。
  const foodShortfall = upkeepShortfall.food ?? 0;
  const hungerPenalty = config.hungerPenaltyWhenNoFoodPerHour ?? 0;
  if (foodShortfall > 0 && hungerPenalty > 0 && dtHours > 0) {
    const extra = hungerPenalty * dtHours;
    // 就地扣减：契约签名不返回宠物，调用方（advanceProfile）传入的已是副本。
    for (const pet of active) {
      pet.condition = {
        ...pet.condition,
        hunger: clamp(pet.condition.hunger - extra, 0, 100),
      };
    }
  }

  return {
    habitat: {
      ...habitat,
      stored,
      lastEvaluatedAt: now,
    },
    produced,
    upkeepShortfall,
  };
}

function petsInHabitat(pets: Profile['pets'], habitat: HabitatInstance): PetInstance[] {
  const out: PetInstance[] = [];
  for (const petId of habitat.slots) {
    if (!petId) continue;
    const pet = pets[petId];
    if (pet) out.push(pet);
  }
  return out;
}

function diffPets(before: Profile['pets'], after: Profile['pets']): PetInstance[] | undefined {
  const upsert: PetInstance[] = [];
  for (const [petId, pet] of Object.entries(after)) {
    const previous = before[petId];
    if (!previous || !sameJson(previous, pet)) upsert.push(pet);
  }
  return upsert.length > 0 ? upsert : undefined;
}

function diffHabitats(
  before: Profile['habitats'],
  after: Profile['habitats'],
): HabitatInstance[] | undefined {
  const upsert: HabitatInstance[] = [];
  for (const [habitatId, habitat] of Object.entries(after)) {
    const previous = before[habitatId];
    if (!previous || !sameJson(previous, habitat)) upsert.push(habitat);
  }
  return upsert.length > 0 ? upsert : undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function advanceProfileImpl(
  profile: Profile,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');

  const pets: Profile['pets'] = {};
  for (const [petId, pet] of Object.entries(profile.pets)) {
    // 1. 阶段 → 状态 → 冷却
    const advanced = advancePetImpl(pet, now, cfg).pet;

    // 2. 状态衰减：只对在栖息地里的非蛋宠物生效（DOMAIN §5.2）。
    if (advanced.habitatId != null) {
      const habitat = profile.habitats[advanced.habitatId];
      if (habitat && advanced.stage !== 'egg') {
        const config = cfg.habitat(habitat.configId);
        pets[petId] = {
          ...advanced,
          condition: decayCondition(advanced, config, now - habitat.lastEvaluatedAt),
        };
        continue;
      }
    }
    pets[petId] = advanced;
  }

  // 3. 栖息地产出（使用推进后的状态）
  const habitats: Profile['habitats'] = {};
  for (const [habitatId, habitat] of Object.entries(profile.habitats)) {
    const habitatPets = petsInHabitat(pets, habitat);
    habitats[habitatId] = advanceHabitatImpl(habitat, habitatPets, now, cfg).habitat;
  }

  const timeChanged = now !== profile.lastEvaluatedAt;
  const petsChanged = diffPets(profile.pets, pets);
  const habitatsChanged = diffHabitats(profile.habitats, habitats);
  const changed = timeChanged || petsChanged !== undefined || habitatsChanged !== undefined;

  const next: Profile = {
    ...profile,
    revision: changed ? profile.revision + 1 : profile.revision,
    lastEvaluatedAt: now,
    pets,
    habitats,
  };

  const patch: ProfilePatch = {
    fromRevision: profile.revision,
    toRevision: next.revision,
    at: now,
    lastEvaluatedAt: now,
  };
  if (petsChanged) patch.pets = { upsert: petsChanged };
  if (habitatsChanged) patch.habitats = { upsert: habitatsChanged };

  return { profile: next, patch };
}
