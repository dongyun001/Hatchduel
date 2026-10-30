/**
 * 栖息地操作（contract-v1.3 D-12）。
 *
 * 六个函数统一返回 `{ profile, patch }`：
 * - 不改入参；`patch.fromRevision = patch.toRevision = profile.revision`（revision 由服务端写操作统一 +1）；
 * - `patch.at` = 传入的 `now`，`patch.lastEvaluatedAt` = 存档当前值（时间推进由 `advanceProfile` 负责）。
 *
 * 校验失败抛 `Error`：`name = 'HabitatError'`，并带 `code`（见 DOMAIN_MODEL §15.7）。
 */
import type { ConfigRepo, FoodConfig, HabitatConfig } from './config/types.js';
import { TimeError } from './errors.js';
import type { EpochMs, Id, ResourceId } from './types/common.js';
import type { HabitatId, PetId, PetInstance } from './types/pet.js';
import type { HabitatInstance, Profile, ProfilePatch, ResourceBag, ResourceCost } from './types/profile.js';
import { buildProfilePatch } from './profile-patch.js';

export type HabitatErrorCode =
  | 'pet_not_found'
  | 'egg_not_allowed'
  | 'habitat_not_found'
  | 'food_not_found'
  | 'capacity_full'
  | 'insufficient_resources'
  | 'max_level'
  | 'slot_conflict';

interface HabitatError extends Error {
  code: HabitatErrorCode;
}

function fail(code: HabitatErrorCode): never {
  const error = new Error(`@petbattle/core: ${code}`) as HabitatError;
  error.name = 'HabitatError';
  error.code = code;
  throw error;
}

export interface HabitatOpResult {
  profile: Profile;
  patch: ProfilePatch;
}

const DEFAULT_CARE_RECOVERY = { clean: 20, play: 20 } as const;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resultOf(before: Profile, after: Profile, now: EpochMs): HabitatOpResult {
  return { profile: after, patch: buildProfilePatch(before, after, now) };
}

function assertTime(profile: Profile, now: EpochMs): void {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');
}

function getPet(profile: Profile, petId: PetId): PetInstance {
  const pet = profile.pets[petId];
  if (!pet) fail('pet_not_found');
  return pet;
}

function getHabitat(profile: Profile, habitatId: HabitatId): HabitatInstance {
  const habitat = profile.habitats[habitatId];
  if (!habitat) fail('habitat_not_found');
  return habitat;
}

function getFood(cfg: ConfigRepo, foodId: Id): FoodConfig {
  try {
    return cfg.food(foodId);
  } catch {
    return fail('food_not_found');
  }
}

function levelEntry(config: HabitatConfig, level: number) {
  const entry = config.upgrade.levels.find((item) => item.level === level);
  if (entry) return entry;
  // 存档等级高于配置（降级配置）时用最高一级兜底，避免读档即崩。
  const last = config.upgrade.levels[config.upgrade.levels.length - 1];
  if (!last) fail('slot_conflict');
  return last;
}

function assertNotEmptyEgg(pet: PetInstance): void {
  if (pet.stage === 'egg') fail('egg_not_allowed');
}

/** 扣资源；不足抛 `insufficient_resources`。 */
function spend(profile: Profile, cost: readonly ResourceCost[]): Profile['currencies'] {
  const currencies = { ...profile.currencies };
  for (const item of cost) {
    if ((currencies[item.resource] ?? 0) < item.amount) fail('insufficient_resources');
  }
  for (const item of cost) {
    currencies[item.resource] = (currencies[item.resource] ?? 0) - item.amount;
  }
  return currencies;
}

function withPet(profile: Profile, pet: PetInstance): Profile {
  return { ...profile, pets: { ...profile.pets, [pet.id]: pet } };
}

function withHabitat(profile: Profile, habitat: HabitatInstance): Profile {
  return { ...profile, habitats: { ...profile.habitats, [habitat.id]: habitat } };
}

function withCurrencies(profile: Profile, currencies: Profile['currencies']): Profile {
  return { ...profile, currencies };
}

/** 把槽位补齐/裁剪到容量；裁剪时若末尾还有宠物则拒绝（数据不一致）。 */
function normalizeSlots(slots: Array<PetId | null>, capacity: number): Array<PetId | null> {
  const next = [...slots];
  while (next.length < capacity) next.push(null);
  while (next.length > capacity) {
    if (next[next.length - 1] !== null) fail('slot_conflict');
    next.pop();
  }
  return next;
}

function removeFromHabitats(profile: Profile, petId: PetId): Profile['habitats'] {
  const habitats = { ...profile.habitats };
  for (const [id, habitat] of Object.entries(habitats)) {
    if (!habitat.slots.includes(petId)) continue;
    habitats[id] = {
      ...habitat,
      slots: habitat.slots.map((slot) => (slot === petId ? null : slot)),
    };
  }
  return habitats;
}

/** 放入 / 移出栖息地；`habitatId = null` 表示移出。 */
export function movePetToHabitatImpl(
  profile: Profile,
  petId: PetId,
  habitatId: HabitatId | null,
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const pet = getPet(profile, petId);
  assertNotEmptyEgg(pet);

  if (habitatId === null) {
    const inAnySlot = Object.values(profile.habitats).some((habitat) =>
      habitat.slots.includes(petId),
    );
    if (pet.habitatId === null && !inAnySlot) return resultOf(profile, profile, now);
    const cleaned: Profile = { ...profile, habitats: removeFromHabitats(profile, petId) };
    const next = withPet(cleaned, { ...pet, habitatId: null, updatedAt: now });
    return resultOf(profile, next, now);
  }

  const target = getHabitat(profile, habitatId);
  const config = cfg.habitat(target.configId);
  const capacity = levelEntry(config, target.level).capacity;

  // 已在该栖息地：幂等。
  if (pet.habitatId === habitatId && target.slots.includes(petId)) {
    return resultOf(profile, profile, now);
  }

  // 先从所有槽位移除，保证“一只宠物只占一个槽位”。
  const cleanedHabitats = removeFromHabitats(profile, petId);
  const targetAfterClean = cleanedHabitats[target.id] ?? target;
  const slots = normalizeSlots(targetAfterClean.slots, capacity);
  const emptyIndex = slots.indexOf(null);
  if (emptyIndex < 0) fail('capacity_full');
  slots[emptyIndex] = petId;

  const nextHabitat: HabitatInstance = { ...targetAfterClean, slots };
  const nextProfile = withPet(
    { ...profile, habitats: { ...cleanedHabitats, [nextHabitat.id]: nextHabitat } },
    { ...pet, habitatId, updatedAt: now },
  );
  return resultOf(profile, nextProfile, now);
}

/** 喂食：扣 `FoodConfig.cost`，按 `nutrition` / `mood` 恢复。 */
export function feedPetImpl(
  profile: Profile,
  petId: PetId,
  foodId: Id,
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const pet = getPet(profile, petId);
  assertNotEmptyEgg(pet);
  const food = getFood(cfg, foodId);

  const currencies = spend(profile, food.cost);
  const nextPet: PetInstance = {
    ...pet,
    condition: {
      ...pet.condition,
      hunger: clamp(pet.condition.hunger + food.nutrition, 0, 100),
      mood: clamp(pet.condition.mood + food.mood, 0, 100),
    },
    updatedAt: now,
  };

  const nextProfile = withPet(withCurrencies(profile, currencies), nextPet);
  return resultOf(profile, nextProfile, now);
}

function careRecovery(
  cfg: ConfigRepo,
  profile: Profile,
  pet: PetInstance,
): { clean: number; play: number } {
  if (pet.habitatId === null) return { ...DEFAULT_CARE_RECOVERY };
  const habitat = profile.habitats[pet.habitatId];
  if (!habitat) return { ...DEFAULT_CARE_RECOVERY };
  const recovery = cfg.habitat(habitat.configId).careRecoveryPerAction;
  return {
    clean: recovery?.clean ?? DEFAULT_CARE_RECOVERY.clean,
    play: recovery?.play ?? DEFAULT_CARE_RECOVERY.play,
  };
}

/** 清洁：恢复 hygiene（默认 +20），不消耗资源。 */
export function cleanPetImpl(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const pet = getPet(profile, petId);
  assertNotEmptyEgg(pet);
  const recovery = careRecovery(cfg, profile, pet);
  const nextPet: PetInstance = {
    ...pet,
    condition: {
      ...pet.condition,
      hygiene: clamp(pet.condition.hygiene + recovery.clean, 0, 100),
    },
    updatedAt: now,
  };
  return resultOf(profile, withPet(profile, nextPet), now);
}

/** 陪玩：恢复 mood（默认 +20），不消耗资源。 */
export function playWithPetImpl(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const pet = getPet(profile, petId);
  assertNotEmptyEgg(pet);
  const recovery = careRecovery(cfg, profile, pet);
  const nextPet: PetInstance = {
    ...pet,
    condition: {
      ...pet.condition,
      mood: clamp(pet.condition.mood + recovery.play, 0, 100),
    },
    updatedAt: now,
  };
  return resultOf(profile, withPet(profile, nextPet), now);
}

/** 升级栖息地：扣 `upgrade.levels[level+1].cost`，按配置扩容量、重算 slots。 */
export function upgradeHabitatImpl(
  profile: Profile,
  habitatId: HabitatId,
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const habitat = getHabitat(profile, habitatId);
  const config = cfg.habitat(habitat.configId);

  if (habitat.level >= config.upgrade.maxLevel) fail('max_level');
  const nextLevel = config.upgrade.levels.find((entry) => entry.level === habitat.level + 1);
  if (!nextLevel) fail('max_level');

  const currencies = spend(profile, nextLevel.cost);
  const slots = normalizeSlots(habitat.slots, nextLevel.capacity);
  const nextHabitat: HabitatInstance = { ...habitat, level: nextLevel.level, slots };

  const nextProfile = withHabitat(withCurrencies(profile, currencies), nextHabitat);
  return resultOf(profile, nextProfile, now);
}

/** 领取产出：`stored` 转入 `currencies`；货币取整，小数零头留在 `stored` 下次再领。 */
export function collectHabitatImpl(
  profile: Profile,
  habitatId: HabitatId,
  now: EpochMs,
  _cfg: ConfigRepo,
): HabitatOpResult {
  assertTime(profile, now);
  const habitat = getHabitat(profile, habitatId);

  const collected: ResourceBag = {};
  const stored: ResourceBag = { ...habitat.stored };
  for (const [resource, amount] of Object.entries(stored) as Array<[ResourceId, number]>) {
    const whole = Math.floor(amount);
    if (whole > 0) {
      collected[resource] = whole;
      stored[resource] = amount - whole;
    }
  }

  if (Object.keys(collected).length === 0) {
    return resultOf(profile, profile, now);
  }

  const currencies = { ...profile.currencies };
  for (const [resource, amount] of Object.entries(collected) as Array<[ResourceId, number]>) {
    currencies[resource] = (currencies[resource] ?? 0) + amount;
  }

  const nextProfile = withHabitat(
    withCurrencies(profile, currencies),
    { ...habitat, stored },
  );
  return resultOf(profile, nextProfile, now);
}
