/**
 * 1000 次繁殖的基因分布 + 近亲影响。
 *
 * 遗传算法、近亲判定、Irwin–Hall 波动全部由 core 负责；sim 只构造父母、
 * 注入 `Rng` 并统计子代。core 未实现时返回 `unavailable`。
 */
import {
  CoreNotImplementedError,
  advancePet,
  breed,
  isInbred,
  type ConfigData,
  type ConfigRepo,
  type Gender,
  type PetInstance,
} from '@petbattle/core';

import { createRng } from './rng.js';
import { makeAdultPet } from './fixtures.js';
import type { BreedingGroup, BreedingStats, GeneSummary } from './types.js';

const GENE_KEYS = ['hp', 'atk', 'def', 'spd'] as const;

export interface BreedingBatchOptions {
  samples: number;
  seed: number;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeError(error: unknown): string {
  if (error instanceof CoreNotImplementedError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function unavailableBreeding(reason: string): BreedingStats {
  const emptyGene: GeneSummary = { mean: { hp: 0, atk: 0, def: 0, spd: 0 }, std: { hp: 0, atk: 0, def: 0, spd: 0 } };
  return {
    status: 'unavailable',
    reason,
    samples: 0,
    species: {},
    element: {},
    overall: { samples: 0, gene: emptyGene, mutationRate: 0, avgExpressedTraits: 0 },
    inbredRate: 0,
    inbred: null,
    control: null,
    invalidNumbers: 0,
  };
}

function summarize(children: readonly PetInstance[]): BreedingGroup {
  const samples = children.length;
  const gene: GeneSummary = {
    mean: { hp: 0, atk: 0, def: 0, spd: 0 },
    std: { hp: 0, atk: 0, def: 0, spd: 0 },
  };
  if (samples === 0) return { samples, gene, mutationRate: 0, avgExpressedTraits: 0 };

  for (const key of GENE_KEYS) {
    const values = children.map((child) => child.genome.stats[key]);
    const mean = values.reduce((sum, value) => sum + value, 0) / samples;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples;
    gene.mean[key] = round(mean);
    gene.std[key] = round(Math.sqrt(variance));
  }

  const mutations = children.filter((child) => child.genome.mutationCount > 0).length;
  const traits = children.reduce((sum, child) => sum + child.traits.length, 0);

  return {
    samples,
    gene,
    mutationRate: round(mutations / samples),
    avgExpressedTraits: round(traits / samples, 2),
  };
}

function makeFounders(cfg: ConfigRepo, data: ConfigData): { males: PetInstance[]; females: PetInstance[] } {
  const males: PetInstance[] = [];
  const females: PetInstance[] = [];
  let index = 0;
  for (const species of data.species) {
    for (const element of data.elements) {
      const gender: Gender = index % 2 === 0 ? 'male' : 'female';
      const pet = makeAdultPet(cfg, {
        id: `sim_founder_${index}`,
        speciesId: species.id,
        elementId: element.id,
        gender,
        gene: 50 + ((index * 7) % 21),
        level: 5,
      });
      (gender === 'male' ? males : females).push(pet);
      index += 1;
    }
  }
  return { males, females };
}

function advanceToAdult(cfg: ConfigRepo, pet: PetInstance): PetInstance {
  const breeding = cfg.breeding();
  const hatchAt = pet.bornAt + breeding.hatchMs + 1;
  const adultAt = hatchAt + breeding.juvenileMs + 2;
  const juvenile = advancePet(pet, hatchAt, cfg).pet;
  return advancePet(juvenile, adultAt, cfg).pet;
}

export function runBreedingBatch(
  cfg: ConfigRepo,
  data: ConfigData,
  options: BreedingBatchOptions,
): BreedingStats {
  try {
    const { males, females } = makeFounders(cfg, data);
    if (males.length === 0 || females.length === 0) {
      return unavailableBreeding('founder 池缺少某一性别，无法繁殖');
    }

    const rng = createRng(options.seed);
    const children: PetInstance[] = [];
    const species: Record<string, number> = {};
    const element: Record<string, number> = {};
    let inbredCount = 0;
    let invalidNumbers = 0;

    for (let index = 0; index < options.samples; index += 1) {
      const father = rng.pick(males);
      const mother = rng.pick(females);
      if (isInbred(father, mother, cfg.breeding().inbreeding.generations)) inbredCount += 1;

      const { child } = breed(father, mother, 0, cfg, rng);
      children.push(child);
      species[child.speciesId] = (species[child.speciesId] ?? 0) + 1;
      element[child.elementId] = (element[child.elementId] ?? 0) + 1;
      for (const key of GENE_KEYS) {
        if (!Number.isFinite(child.genome.stats[key])) invalidNumbers += 1;
      }
    }

    // 近亲 vs 非近亲对照：A×B 生子 C，再用 A×C（近亲）与 C×D（非近亲）。
    const father = males[0];
    const mother = females[0];
    const outsider = females[1];
    if (!father || !mother || !outsider) return unavailableBreeding('founder 池不足以做近亲对照');

    const rng2 = createRng(options.seed + 1);
    const childEgg = breed(father, mother, 0, cfg, rng2).child;
    const adultChild = advanceToAdult(cfg, childEgg);

    const inbredChildren: PetInstance[] = [];
    const controlChildren: PetInstance[] = [];
    for (let index = 0; index < options.samples; index += 1) {
      inbredChildren.push(breed(father, adultChild, 0, cfg, rng2).child);
      controlChildren.push(breed(adultChild, outsider, 0, cfg, rng2).child);
    }

    return {
      status: 'ok',
      samples: options.samples,
      species,
      element,
      overall: summarize(children),
      inbredRate: round(inbredCount / Math.max(1, options.samples)),
      inbred: summarize(inbredChildren),
      control: summarize(controlChildren),
      invalidNumbers,
    };
  } catch (error) {
    return unavailableBreeding(describeError(error));
  }
}
