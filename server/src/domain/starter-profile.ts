/**
 * 新账号的初始存档（PRD §5.5：初始 3 只 —— 水龟、雷鱼、草蛙）。
 *
 * 规则全部由 `@petbattle/core` 决定，这里只做**编排**：
 * - `createPet` 建个体（出生时间取 `now - hatchMs - juvenileMs`，让推进后正好成年）；
 * - `advanceProfile` 推进整档，把三只从蛋推进到成年，并顺带结算栖息地（dt=0，无产出）；
 * - 服务端不手写阶段阈值、状态衰减或产出公式（PITFALLS P-030 同类问题）。
 *
 * 首次登录的存档 `revision = 0`、`createdAt = lastEvaluatedAt = now`：
 * 推进只是为了把初始宠物“显形”为成年，不应让客户端看到一次虚假的写操作。
 */
import { randomUUID } from 'node:crypto';

import { advanceProfile as coreAdvanceProfile, createPet } from '@petbattle/core';
import type {
  CodexEntry,
  CodexKey,
  ConfigRepo,
  EpochMs,
  ElementId,
  Gender,
  HabitatConfig,
  HabitatInstance,
  Id,
  PetId,
  PetInstance,
  Profile,
} from '@petbattle/core';

/** 存档结构版本；结构变更时 +1 并补迁移（ONLINE_DESIGN §4.4）。 */
export const PROFILE_STRUCTURE_VERSION = 1;

/** PvP 初始分；段位细则待 D/C 定（CONTRACT §10.3），先给中性初值。 */
export const STARTING_PVP_RATING = 1000;

export const PRESEASON_ID = 'preseason';

/** 初始栖息地：草甸 1 级（4 格，3 只占位 + 1 空）。 */
export const STARTER_HABITAT_CONFIG_ID = 'meadow';
export const STARTER_HABITAT_ID = 'habitat_meadow';
export const STARTER_HABITAT_LEVEL = 1;

/** 初始四项基因一律 50（DOMAIN §3 的中位值）；特质为空。 */
export const STARTER_GENE = 50;

export interface StarterPetSpec {
  speciesId: Id;
  elementId: ElementId;
  gender: Gender;
}

/** 性别固定 1 公 1 母（PITFALLS P-008：首日必须能繁殖）。 */
export const STARTER_PET_SPECS: readonly StarterPetSpec[] = [
  { speciesId: 'turtle', elementId: 'water', gender: 'male' },
  { speciesId: 'fish', elementId: 'thunder', gender: 'female' },
  { speciesId: 'frog', elementId: 'grass', gender: 'male' },
];

export function createInitialProfile(accountId: string, now: EpochMs, cfg: ConfigRepo): Profile {
  const breeding = cfg.breeding();
  // 出生时间回拨孵化 + 幼年时长：advanceProfile 在 `now` 正好把三只推进到成年。
  const bornAt = now - breeding.hatchMs - breeding.juvenileMs;

  const habitatConfig = cfg.habitat(STARTER_HABITAT_CONFIG_ID);
  const capacity = habitatLevelCapacity(habitatConfig, STARTER_HABITAT_LEVEL);

  const pets: Record<PetId, PetInstance> = {};
  const petIds: PetId[] = [];

  for (const spec of STARTER_PET_SPECS) {
    const pet = createPet(
      {
        id: `pet_${randomUUID()}`,
        speciesId: spec.speciesId,
        elementId: spec.elementId,
        genome: {
          stats: { hp: STARTER_GENE, atk: STARTER_GENE, def: STARTER_GENE, spd: STARTER_GENE },
          speciesAlleles: [spec.speciesId, spec.speciesId],
          elementAlleles: [spec.elementId, spec.elementId],
          traitAlleles: [],
          mutationCount: 0,
        },
        gender: spec.gender,
        generation: 1,
        parents: [null, null],
        now: bornAt,
      },
      cfg,
    );

    const homed: PetInstance = { ...pet, habitatId: STARTER_HABITAT_ID };
    pets[homed.id] = homed;
    petIds.push(homed.id);
  }

  const slots: Array<PetId | null> = [...petIds];
  while (slots.length < capacity) slots.push(null);

  const habitat: HabitatInstance = {
    id: STARTER_HABITAT_ID,
    configId: STARTER_HABITAT_CONFIG_ID,
    level: STARTER_HABITAT_LEVEL,
    slots,
    // 同一个 now：首次登录不结算离线产出。
    lastEvaluatedAt: now,
    stored: {},
  };

  const codex: Record<CodexKey, CodexEntry> = {};
  for (const spec of STARTER_PET_SPECS) {
    codex[`${spec.speciesId}:${spec.elementId}`] = {
      seen: true,
      owned: true,
      bestGene: STARTER_GENE,
    };
  }

  const initial: Profile = {
    version: PROFILE_STRUCTURE_VERSION,
    accountId,
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: buildStartingCurrencies(cfg),
    pets,
    habitats: { [habitat.id]: habitat },
    codex,
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: STARTING_PVP_RATING, seasonId: PRESEASON_ID },
    settings: { sfx: true, bgm: true },
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      breeds: 0,
      hatchlings: 0,
      mutations: 0,
      released: 0,
    },
  };

  const advanced = coreAdvanceProfile(initial, now, cfg).profile;
  assertStarterReady(advanced, now);

  return {
    ...advanced,
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
  };
}

function buildStartingCurrencies(cfg: ConfigRepo): Profile['currencies'] {
  const starting = cfg.economy().startingResources;
  return {
    coin: starting.coin ?? 0,
    food: starting.food ?? 0,
    geneDust: starting.geneDust ?? 0,
    premium: starting.premium ?? 0,
  };
}

function habitatLevelCapacity(config: HabitatConfig, level: number): number {
  const entry = config.upgrade.levels.find((item) => item.level === level);
  return entry?.capacity ?? config.capacity;
}

/** 初始档不变量；违反说明配置或 core 行为变了，宁可失败也不发给客户端错误存档。 */
function assertStarterReady(profile: Profile, now: EpochMs): void {
  const pets = Object.values(profile.pets);
  if (pets.length !== STARTER_PET_SPECS.length) {
    throw new Error(`初始存档应有 ${STARTER_PET_SPECS.length} 只宠物，实际 ${pets.length}`);
  }

  let males = 0;
  let females = 0;
  for (const pet of pets) {
    if (pet.gender === 'male') males += 1;
    else females += 1;

    if (pet.stage !== 'adult') {
      throw new Error(`初始宠物 ${pet.id} 推进后仍是 ${pet.stage}，期望 adult（检查 breeding.hatchMs/juvenileMs）`);
    }
    if (pet.fertility.readyAt > now) {
      throw new Error(`初始宠物 ${pet.id} 尚不可繁殖：readyAt=${pet.fertility.readyAt} > now=${now}`);
    }
    if (pet.habitatId !== STARTER_HABITAT_ID) {
      throw new Error(`初始宠物 ${pet.id} 未放入初始栖息地`);
    }
  }

  if (males < 1 || females < 1) {
    throw new Error(`初始宠物性别配置必须包含至少 1 公 1 母，实际 male=${males} female=${females}`);
  }
}
