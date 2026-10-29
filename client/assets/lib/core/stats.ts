// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * 派生属性（DOMAIN_MODEL §4.1/§4.2）。
 *
 * ```
 * 最终值 = floor(base × levelMul × stageMul × geneMul × condMul × traitMul × passiveMul × affinityMul)
 * ```
 *
 * - `levelMul / stageMul / geneMul / affinityMul` 只作用于 hp/atk/def/spd；
 * - `crit / critDmg / hit / dodge` 只乘 `condMul / traitMul / passiveMul`；
 * - 取整只在最后一步；比例类属性（crit/critDmg/hit/dodge）保留 4 位小数后 clamp，
 *   否则 `floor(0.05 × 1.06) = 0` 会把暴击率抹平（DOMAIN §1「倍率保留 4 位小数」）。
 * - 蛋阶段不参与战斗，全部返回 0。
 */
import {
  AFFINITY_MULTIPLIER_STEP,
  CONDITION_MUL_BASE,
  CONDITION_MUL_SPAN,
  GENE_MUL_BASE,
  GENE_MUL_SPAN,
  STAGE_MULTIPLIERS,
} from './constants';
import type { ConfigRepo } from './config/types';
import type { PetInstance } from './types/pet';
import type { CoreStatKey, StatBlock, StatKey } from './types/stats';

const CORE_STATS: readonly CoreStatKey[] = ['hp', 'atk', 'def', 'spd'];

type StatMods = Partial<Record<StatKey, number>>;

export interface ComputeStatsInput {
  base: StatBlock;
  growth: Record<CoreStatKey, number>;
  level: number;
  stage: keyof typeof STAGE_MULTIPLIERS;
  gene: Record<CoreStatKey, number>;
  condition: { hunger: number; mood: number; hygiene: number; health: number };
  /** 相性 -1 / 0 / 1。 */
  affinity: number;
  traitMods: readonly StatMods[];
  passiveMods: readonly StatMods[];
}

const ZERO_STATS: StatBlock = Object.freeze({
  hp: 0,
  atk: 0,
  def: 0,
  spd: 0,
  crit: 0,
  critDmg: 0,
  hit: 0,
  dodge: 0,
});

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 保留 4 位小数（不用 Math.round，避免 -0 与跨引擎差异；只用四则运算）。 */
function round4(value: number): number {
  return Math.floor(value * 10000 + 0.5) / 10000;
}

function productMod(mods: readonly StatMods[], key: StatKey): number {
  let mul = 1;
  for (const mod of mods) {
    const value = mod[key];
    if (value !== undefined) mul *= value;
  }
  return mul;
}

export function computeStats(input: ComputeStatsInput): StatBlock {
  if (input.stage === 'egg') return { ...ZERO_STATS };

  const level = input.level < 1 ? 1 : input.level;
  const condSum =
    clamp(input.condition.hunger, 0, 100) +
    clamp(input.condition.mood, 0, 100) +
    clamp(input.condition.hygiene, 0, 100) +
    clamp(input.condition.health, 0, 100);
  const condMul = CONDITION_MUL_BASE + (condSum / 400) * CONDITION_MUL_SPAN;
  const stageMul = STAGE_MULTIPLIERS[input.stage];
  const affinityMul = 1 + input.affinity * AFFINITY_MULTIPLIER_STEP;

  const core: Record<CoreStatKey, number> = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const key of CORE_STATS) {
    const levelMul = 1 + input.growth[key] * (level - 1);
    const geneMul = GENE_MUL_BASE + (clamp(input.gene[key], 0, 100) / 100) * GENE_MUL_SPAN;
    core[key] = Math.floor(
      input.base[key] *
        levelMul *
        stageMul *
        geneMul *
        condMul *
        productMod(input.traitMods, key) *
        productMod(input.passiveMods, key) *
        affinityMul,
    );
  }

  const crit = round4(
    input.base.crit *
      condMul *
      productMod(input.traitMods, 'crit') *
      productMod(input.passiveMods, 'crit'),
  );
  const critDmg = round4(
    input.base.critDmg *
      condMul *
      productMod(input.traitMods, 'critDmg') *
      productMod(input.passiveMods, 'critDmg'),
  );
  const hit = round4(
    input.base.hit *
      condMul *
      productMod(input.traitMods, 'hit') *
      productMod(input.passiveMods, 'hit'),
  );
  const dodge = round4(
    input.base.dodge *
      condMul *
      productMod(input.traitMods, 'dodge') *
      productMod(input.passiveMods, 'dodge'),
  );

  return {
    hp: core.hp,
    atk: core.atk,
    def: core.def,
    spd: core.spd,
    crit: clamp(crit, 0, 1),
    critDmg,
    hit: clamp(hit, -0.5, 0.5),
    dodge: clamp(dodge, 0, 0.9),
  };
}

export function deriveStatsImpl(pet: PetInstance, cfg: ConfigRepo): StatBlock {
  const species = cfg.species(pet.speciesId);
  if (pet.stage === 'egg') return { ...ZERO_STATS };

  const traitMods: StatMods[] = [];
  for (const trait of cfg.traitsFor(pet)) {
    if (trait.statMods) traitMods.push(trait.statMods);
  }
  const passiveMods: StatMods[] = [];
  if (species.passiveId) {
    const passive = cfg.passive(species.passiveId);
    if (passive.statMods) passiveMods.push(passive.statMods);
  }

  return computeStats({
    base: species.base,
    growth: species.growth,
    level: pet.level,
    stage: pet.stage,
    gene: pet.genome.stats,
    condition: pet.condition,
    affinity: cfg.affinity(pet.elementId, pet.speciesId),
    traitMods,
    passiveMods,
  });
}
