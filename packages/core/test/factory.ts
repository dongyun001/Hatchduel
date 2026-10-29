/** 测试工厂：构造 config repo / 宠物 / 存档，避免每个用例重复样板。 */
import {
  createConfigRepo,
  type ConfigData,
  type ConfigRepo,
  type ElementId,
  type Genome,
  type PetInstance,
  type Profile,
  type Stage,
} from '@petbattle/core';

import { asRecord, asRecordArray, cloneFixture } from './fixtures.js';

export const T0 = 1_700_000_000_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export type ConfigMutator = (config: Record<string, unknown>) => void;

export function makeRepo(mutate?: ConfigMutator): ConfigRepo {
  const config = cloneFixture();
  if (mutate) mutate(config);
  return createConfigRepo(config as unknown as ConfigData);
}

export function repoOf(data: Record<string, unknown>): ConfigRepo {
  return createConfigRepo(data as unknown as ConfigData);
}

export function makeGenome(overrides: Partial<Genome['stats']> = {}): Genome {
  return {
    stats: { hp: 60, atk: 60, def: 60, spd: 60, ...overrides },
    speciesAlleles: ['fish', 'fish'],
    elementAlleles: ['water', 'water'],
    traitAlleles: [],
    mutationCount: 0,
  };
}

export interface PetOptions {
  id?: string;
  speciesId?: string;
  elementId?: ElementId;
  stage?: Stage;
  gender?: 'male' | 'female';
  level?: number;
  traits?: string[];
  hiddenTraits?: string[];
  genome?: Genome;
  generation?: number;
  parents?: [string | null, string | null];
  ancestors?: Array<{ id: string; depth: number }>;
  bornAt?: number;
  stageChangedAt?: number;
  habitatId?: string | null;
  locked?: boolean;
  condition?: Partial<PetInstance['condition']>;
  fertility?: Partial<PetInstance['fertility']>;
  updatedAt?: number;
}

export function makePet(options: PetOptions = {}): PetInstance {
  const stage = options.stage ?? 'adult';
  // 默认「刚成年」：出生 2 小时前、阶段在 1 小时前变更，避免默认宠物立刻老化。
  const bornAt = options.bornAt ?? T0 - 2 * HOUR;
  return {
    id: options.id ?? 'pet_1',
    speciesId: options.speciesId ?? 'fish',
    elementId: options.elementId ?? 'water',
    genome: options.genome ?? makeGenome(),
    traits: options.traits ?? [],
    hiddenTraits: options.hiddenTraits ?? [],
    gender: options.gender ?? 'male',
    generation: options.generation ?? 1,
    parents: options.parents ?? [null, null],
    ancestors: options.ancestors ?? [],
    bornAt,
    stage,
    stageChangedAt: options.stageChangedAt ?? (options.bornAt ?? T0 - 2 * HOUR) + HOUR,
    level: options.level ?? 1,
    exp: 0,
    condition: { hunger: 100, mood: 100, hygiene: 100, health: 100, ...options.condition },
    fertility: { readyAt: 0, cooldownUntil: 0, penalty: 0, ...options.fertility },
    habitatId: options.habitatId ?? null,
    locked: options.locked ?? false,
    createdAt: bornAt,
    updatedAt: options.updatedAt ?? T0,
  };
}

export function makeProfile(pets: PetInstance[] = [], slots: Array<string | null> = []): Profile {
  const petMap: Record<string, PetInstance> = {};
  for (const pet of pets) petMap[pet.id] = pet;
  return {
    version: 1,
    accountId: 'acct_1',
    revision: 1,
    createdAt: T0,
    lastEvaluatedAt: T0,
    currencies: { coin: 1000, food: 100, geneDust: 10, premium: 0 },
    pets: petMap,
    habitats: {
      meadow: {
        id: 'meadow',
        configId: 'meadow',
        level: 1,
        slots,
        lastEvaluatedAt: T0,
        stored: {},
      },
    },
    codex: {},
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 's1' },
    settings: { sfx: true, bgm: true },
    stats: { battlesWon: 0, battlesLost: 0, breeds: 0, hatchlings: 0, mutations: 0, released: 0 },
  };
}

/** 读取/替换 JSON 片段（避免 any）。 */
export function speciesRow(config: Record<string, unknown>, id: string): Record<string, unknown> {
  const row = asRecordArray(config['species']).find((item) => item['id'] === id);
  if (!row) throw new Error(`missing species ${id}`);
  return row;
}

export function skillRow(config: Record<string, unknown>, id: string): Record<string, unknown> {
  const row = asRecordArray(config['skills']).find((item) => item['id'] === id);
  if (!row) throw new Error(`missing skill ${id}`);
  return row;
}

export function habitatRow(config: Record<string, unknown>, id: string): Record<string, unknown> {
  const row = asRecordArray(config['habitats']).find((item) => item['id'] === id);
  if (!row) throw new Error(`missing habitat ${id}`);
  return row;
}

export function addTrait(config: Record<string, unknown>, trait: Record<string, unknown>): void {
  asRecordArray(config['traits']).push(trait);
}

export function addSkill(config: Record<string, unknown>, skill: Record<string, unknown>): void {
  asRecordArray(config['skills']).push(skill);
}

export function addPassive(
  config: Record<string, unknown>,
  passive: Record<string, unknown>,
): void {
  asRecordArray(config['passives']).push(passive);
}

export function breedingRow(config: Record<string, unknown>): Record<string, unknown> {
  return asRecord(config['breeding']);
}
