import { advanceProfile, createPet } from '../../lib/core';
import type { ConfigRepo, EpochMs, Genome, PetInstance, Profile, TraitAllele } from '../../lib/core';

/**
 * 离线 mock 存档（M1 第二批）：不再字面构造 PetInstance，统一走 core。
 *
 * 1. `createPet` 在 `now - hatchMs - juvenileMs - 1min` 建三只蛋；
 * 2. 放进草甸栖息地后 `advanceProfile(profile, now)`，按配置推到成年并结算一次产出；
 * 3. 性别/基因是演示数据，真正随机与继承仍由 core 公式负责。
 */
const HABITAT_ID = 'habitat-meadow-1';
const START_MARGIN_MS = 60_000;

function genome(
  stats: Genome['stats'],
  speciesId: string,
  elementId: PetInstance['elementId'],
  traitAlleles: TraitAllele[],
): Genome {
  return {
    stats,
    speciesAlleles: [speciesId, speciesId],
    elementAlleles: [elementId, elementId],
    traitAlleles,
    mutationCount: 0,
  };
}

function alleles(expressed: readonly string[], hidden: readonly string[]): TraitAllele[] {
  return [
    ...expressed.map((traitId) => ({ traitId, dominant: true })),
    ...hidden.map((traitId) => ({ traitId, dominant: false })),
  ];
}

function codexEntry(pet: PetInstance): { seen: boolean; owned: boolean; bestGene: number } {
  const stats = pet.genome.stats;
  return {
    seen: true,
    owned: true,
    bestGene: Math.round((stats.hp + stats.atk + stats.def + stats.spd) / 4),
  };
}

export function createMockProfile(now: EpochMs, cfg: ConfigRepo): Profile {
  const breeding = cfg.breeding();
  const start = now - breeding.hatchMs - breeding.juvenileMs - START_MARGIN_MS;

  const turtle = createPet(
    {
      id: 'pet-turtle-1',
      speciesId: 'turtle',
      elementId: 'water',
      genome: genome(
        { hp: 72, atk: 46, def: 78, spd: 32 },
        'turtle',
        'water',
        alleles(['trait_sturdy'], ['trait_swift']),
      ),
      traits: ['trait_sturdy'],
      hiddenTraits: ['trait_swift'],
      gender: 'male',
      generation: 1,
      level: 5,
      now: start,
    },
    cfg,
  );

  const fish = createPet(
    {
      id: 'pet-fish-1',
      speciesId: 'fish',
      elementId: 'thunder',
      genome: genome(
        { hp: 41, atk: 57, def: 34, spd: 68 },
        'fish',
        'thunder',
        alleles(['trait_swift'], ['trait_nimble']),
      ),
      traits: ['trait_swift'],
      hiddenTraits: ['trait_nimble'],
      gender: 'female',
      generation: 1,
      level: 4,
      now: start,
    },
    cfg,
  );

  const frog = createPet(
    {
      id: 'pet-frog-1',
      speciesId: 'frog',
      elementId: 'grass',
      genome: genome(
        { hp: 52, atk: 61, def: 44, spd: 56 },
        'frog',
        'grass',
        alleles([], ['trait_cheerful']),
      ),
      traits: [],
      hiddenTraits: ['trait_cheerful'],
      gender: 'female',
      generation: 1,
      level: 2,
      now: start,
    },
    cfg,
  );

  for (const pet of [turtle, fish, frog]) {
    pet.habitatId = HABITAT_ID;
  }

  const profile: Profile = {
    version: 1,
    accountId: 'mock-account',
    revision: 1,
    createdAt: start,
    lastEvaluatedAt: start,
    currencies: { coin: 500, food: 100, geneDust: 10, premium: 0 },
    pets: {
      [turtle.id]: turtle,
      [fish.id]: fish,
      [frog.id]: frog,
    },
    habitats: {
      [HABITAT_ID]: {
        id: HABITAT_ID,
        configId: 'meadow',
        level: 1,
        slots: [turtle.id, fish.id, frog.id, null],
        lastEvaluatedAt: start,
        stored: {},
      },
    },
    codex: {
      'turtle:water': codexEntry(turtle),
      'fish:thunder': codexEntry(fish),
      'frog:grass': codexEntry(frog),
    },
    lineup: [turtle.id, fish.id],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 's1' },
    settings: { sfx: true, bgm: true },
    stats: { battlesWon: 0, battlesLost: 0, breeds: 0, hatchlings: 0, mutations: 0, released: 0 },
  };

  // 从建蛋时间推进到 now：阶段变成年、状态衰减一次、栖息地结算一次产出。
  return advanceProfile(profile, now, cfg).profile;
}
