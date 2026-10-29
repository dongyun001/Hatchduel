// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 建个体（DOMAIN_MODEL §3/§5.1/§8.2，contract-v1.2）。
 *
 * 一切新宠物都从蛋开始：`stage = 'egg'`，`bornAt = stageChangedAt = now`，
 * `fertility.readyAt = now + hatchMs + juvenileMs`；派生属性不落库（按需 `deriveStats`）。
 */
import { MAX_LEVEL } from './constants';
import type { ConfigRepo } from './config/types';
import type { CreatePetInput } from './api';
import type { Genome, PetInstance } from './types/pet';
import type { CoreStatKey } from './types/stats';
import type { Id } from './types/common';

const GENE_KEYS: readonly CoreStatKey[] = ['hp', 'atk', 'def', 'spd'];

function normalizeGene(key: CoreStatKey, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`@petbattle/core: 基因 "${key}" 必须是有限数字，实际 ${String(value)}`);
  }
  // 四舍五入后 clamp 到 0~100（DOMAIN §3「0~100 整数」）。
  return Math.min(100, Math.max(0, Math.round(value)));
}

function dedupe(list: readonly Id[] | undefined): Id[] {
  return Array.from(new Set(list ?? []));
}

export function createPetImpl(input: CreatePetInput, cfg: ConfigRepo): PetInstance {
  // 引用校验：不存在时由 ConfigRepo 抛出带表名/id 的明确错误。
  cfg.species(input.speciesId);
  cfg.element(input.elementId);

  const level = input.level ?? 1;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new Error(
      `@petbattle/core: level 必须是 1~${MAX_LEVEL} 的整数，实际 ${String(input.level)}`,
    );
  }

  const stats = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const key of GENE_KEYS) {
    stats[key] = normalizeGene(key, input.genome.stats[key]);
  }

  const breeding = cfg.breeding();
  const now = input.now;

  const genome: Genome = {
    stats,
    speciesAlleles: [...input.genome.speciesAlleles],
    elementAlleles: [...input.genome.elementAlleles],
    traitAlleles: input.genome.traitAlleles.map((allele) => ({ ...allele })),
    mutationCount: input.genome.mutationCount,
  };

  return {
    id: input.id,
    speciesId: input.speciesId,
    elementId: input.elementId,
    genome,
    traits: dedupe(input.traits),
    hiddenTraits: dedupe(input.hiddenTraits),
    gender: input.gender,
    generation: input.generation,
    parents: input.parents ? [...input.parents] : [null, null],
    ancestors: input.ancestors ? input.ancestors.map((ref) => ({ ...ref })) : [],
    bornAt: now,
    stage: 'egg',
    stageChangedAt: now,
    level,
    exp: 0,
    condition: { hunger: 100, mood: 100, hygiene: 100, health: 100 },
    fertility: {
      readyAt: now + breeding.hatchMs + breeding.juvenileMs,
      cooldownUntil: 0,
      penalty: 0,
    },
    habitatId: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}
