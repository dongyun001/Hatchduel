/** 构造模拟用的宠物与存档夹具；所有 ID / 时间戳都由 sim 指定，保持确定性。 */
import {
  advancePet,
  createPet,
  type AncestorRef,
  type ConfigData,
  type ConfigRepo,
  type EpochMs,
  type Gender,
  type Genome,
  type PetInstance,
  type Profile,
  type ResourceId,
} from '@petbattle/core';

export const STARTERS: ReadonlyArray<{ speciesId: string; elementId: 'water' | 'thunder' | 'grass'; gender: Gender }> = [
  { speciesId: 'turtle', elementId: 'water', gender: 'male' },
  { speciesId: 'fish', elementId: 'thunder', gender: 'female' },
  { speciesId: 'frog', elementId: 'grass', gender: 'male' },
];

/** 每关假定的玩家等级（重复刷关 + 繁殖后的预期值，见 docs/BALANCE.md）。 */
export const PLAYER_LEVEL_BY_ORDER: Readonly<Record<number, number>> = {
  1: 1,
  2: 3,
  3: 4,
  4: 6,
  5: 8,
};

export interface PetFixture {
  id: string;
  speciesId: string;
  elementId: 'water' | 'fire' | 'grass' | 'earth' | 'thunder';
  gene?: number;
  level?: number;
  gender?: Gender;
  generation?: number;
  traits?: string[];
  hiddenTraits?: string[];
  ancestors?: AncestorRef[];
  now?: EpochMs;
}

export function createGenome(
  speciesId: string,
  elementId: 'water' | 'fire' | 'grass' | 'earth' | 'thunder',
  gene: number,
): Genome {
  return {
    stats: { hp: gene, atk: gene, def: gene, spd: gene },
    speciesAlleles: [speciesId, speciesId],
    elementAlleles: [elementId, elementId],
    traitAlleles: [],
    mutationCount: 0,
  };
}

/**
 * 建一只“可直接战斗/繁殖”的成年宠物。
 *
 * 通过 core 的 `createPet` + `advancePet` 推进阶段，而不是在 sim 里拼一个
 * `PetInstance` 字面量，避免 sim 与 core 的阶段/时间规则漂移。
 */
export function makeAdultPet(cfg: ConfigRepo, fixture: PetFixture): PetInstance {
  const now = fixture.now ?? 0;
  const breeding = cfg.breeding();
  const pet = createPet(
    {
      id: fixture.id,
      speciesId: fixture.speciesId,
      elementId: fixture.elementId,
      genome: createGenome(fixture.speciesId, fixture.elementId, fixture.gene ?? 50),
      traits: fixture.traits ?? [],
      hiddenTraits: fixture.hiddenTraits ?? [],
      gender: fixture.gender ?? 'male',
      generation: fixture.generation ?? 1,
      parents: [null, null],
      ancestors: fixture.ancestors ?? [],
      level: fixture.level ?? 1,
      now,
    },
    cfg,
  );

  const juvenile = advancePet(pet, now + breeding.hatchMs + 1, cfg).pet;
  return advancePet(juvenile, now + breeding.hatchMs + breeding.juvenileMs + 2, cfg).pet;
}

export interface SimProfileFixture {
  profile: Profile;
  petIds: string[];
  habitatId: string;
}

/** 初始 3 只 + 1 个 4 格草甸，货币取 economy.startingResources。 */
export function makeSimProfile(cfg: ConfigRepo, data: ConfigData, now: EpochMs = 0): SimProfileFixture {
  const habitatConfig = data.habitats[0];
  if (!habitatConfig) throw new Error('配置缺少栖息地');

  const pets = STARTERS.map((starter, index) =>
    makeAdultPet(cfg, {
      id: `sim_pet_${index}`,
      speciesId: starter.speciesId,
      elementId: starter.elementId,
      gender: starter.gender,
      gene: 50,
      level: 1,
      now,
    }),
  );

  const petIds = pets.map((pet) => pet.id);
  const habitatId = 'sim_habitat_1';

  const currencies = {
    coin: data.economy.startingResources.coin ?? 0,
    food: data.economy.startingResources.food ?? 0,
    geneDust: data.economy.startingResources.geneDust ?? 0,
    premium: data.economy.startingResources.premium ?? 0,
  } satisfies Record<ResourceId, number>;

  const slots: Array<string | null> = [];
  for (let index = 0; index < habitatConfig.capacity; index += 1) {
    slots.push(petIds[index] ?? null);
  }

  const profile: Profile = {
    version: 1,
    accountId: 'sim-account',
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies,
    pets: Object.fromEntries(pets.map((pet) => [pet.id, pet])),
    habitats: {
      [habitatId]: {
        id: habitatId,
        configId: habitatConfig.id,
        level: 1,
        slots,
        lastEvaluatedAt: now,
        stored: {},
      },
    },
    codex: {},
    lineup: petIds.slice(0, 3),
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 'sim' },
    settings: { sfx: true, bgm: true },
    stats: { battlesWon: 0, battlesLost: 0, breeds: 0, hatchlings: 0, mutations: 0, released: 0 },
  };

  return { profile, petIds, habitatId };
}
