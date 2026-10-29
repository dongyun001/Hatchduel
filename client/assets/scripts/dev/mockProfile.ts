import type { CodexEntry, CodexKey, EpochMs, Genome, PetInstance, Profile } from '../../lib/core';

/**
 * 离线 mock 存档（M0/M1）：用 `@petbattle/core` 的类型构造，不复制类型、不实现建体逻辑。
 * 初始 3 只：水龟（公，成年）/ 雷鱼（母，成年）/ 草蛙（幼年），保证第一次繁殖可做。
 * `createPet` 目前仍是 core 的契约桩，所以这里直接给出合法个体快照；服务端接入后它会被真实档替换。
 */
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function genome(stats: Genome['stats'], speciesId: string, elementId: GeoElement): Genome {
  return {
    stats,
    speciesAlleles: [speciesId, speciesId],
    elementAlleles: [elementId, elementId],
    traitAlleles: [],
    mutationCount: 0,
  };
}

type GeoElement = 'water' | 'fire' | 'grass' | 'earth' | 'thunder';

interface MockPetInput {
  id: string;
  speciesId: string;
  elementId: GeoElement;
  gender: 'male' | 'female';
  stage: PetInstance['stage'];
  level: number;
  stats: Genome['stats'];
  bornAt: EpochMs;
  stageChangedAt: EpochMs;
  now: EpochMs;
  habitatId: string | null;
}

function makePet(input: MockPetInput): PetInstance {
  return {
    id: input.id,
    name: undefined,
    speciesId: input.speciesId,
    elementId: input.elementId,
    genome: genome(input.stats, input.speciesId, input.elementId),
    traits: [],
    hiddenTraits: [],
    gender: input.gender,
    generation: 1,
    parents: [null, null],
    ancestors: [],
    bornAt: input.bornAt,
    stage: input.stage,
    stageChangedAt: input.stageChangedAt,
    level: input.level,
    exp: 10,
    condition: { hunger: 80, mood: 75, hygiene: 70, health: 100 },
    fertility: {
      readyAt: input.stage === 'adult' ? input.now - DAY : input.now + 2 * HOUR,
      cooldownUntil: 0,
      penalty: 0,
    },
    habitatId: input.habitatId,
    locked: false,
    createdAt: input.bornAt,
    updatedAt: input.now,
  };
}

function codexEntry(bestGene: number): CodexEntry {
  return { seen: true, owned: true, bestGene };
}

export function createMockProfile(now: EpochMs): Profile {
  const turtle = makePet({
    id: 'pet-turtle-1',
    speciesId: 'turtle',
    elementId: 'water',
    gender: 'male',
    stage: 'adult',
    level: 5,
    stats: { hp: 72, atk: 46, def: 78, spd: 32 },
    bornAt: now - 10 * DAY,
    stageChangedAt: now - 3 * DAY,
    now,
    habitatId: 'habitat-meadow-1',
  });

  const fish = makePet({
    id: 'pet-fish-1',
    speciesId: 'fish',
    elementId: 'thunder',
    gender: 'female',
    stage: 'adult',
    level: 4,
    stats: { hp: 41, atk: 57, def: 34, spd: 68 },
    bornAt: now - 9 * DAY,
    stageChangedAt: now - 2 * DAY,
    now,
    habitatId: 'habitat-meadow-1',
  });

  const frog = makePet({
    id: 'pet-frog-1',
    speciesId: 'frog',
    elementId: 'grass',
    gender: 'female',
    stage: 'juvenile',
    level: 2,
    stats: { hp: 52, atk: 61, def: 44, spd: 56 },
    bornAt: now - 3 * HOUR,
    stageChangedAt: now - 3 * HOUR,
    now,
    habitatId: 'habitat-meadow-1',
  });

  const codex: Record<CodexKey, CodexEntry> = {
    'turtle:water': codexEntry(57),
    'fish:thunder': codexEntry(50),
    'frog:grass': codexEntry(53),
  };

  return {
    version: 1,
    accountId: 'mock-account',
    revision: 1,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: { coin: 500, food: 20, geneDust: 0, premium: 0 },
    pets: {
      [turtle.id]: turtle,
      [fish.id]: fish,
      [frog.id]: frog,
    },
    habitats: {
      'habitat-meadow-1': {
        id: 'habitat-meadow-1',
        configId: 'meadow',
        level: 1,
        slots: [turtle.id, fish.id, frog.id, null],
        lastEvaluatedAt: now,
        stored: { coin: 12, food: 3 },
      },
    },
    codex,
    lineup: [turtle.id, fish.id],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 's1' },
    settings: { sfx: true, bgm: true },
    stats: { battlesWon: 0, battlesLost: 0, breeds: 0, hatchlings: 0, mutations: 0, released: 0 },
  };
}
