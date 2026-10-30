// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 繁殖与近亲（DOMAIN_MODEL §8）。
 *
 * 校验顺序固定：同一只 → 性别 → 阶段 → 锁定 → 可繁殖时间 → 冷却 → 空位 → 成本。
 * `breed` 只消费传入的 rng，消费顺序固定（改顺序等于改确定性，需同步快照）。
 */
import type { ConfigRepo } from './config/types';
import type { AncestorRef, Genome, PetInstance, TraitAllele } from './types/pet';
import type { EpochMs, Id, Rng } from './types/common';
import type { Profile } from './types/profile';
import { gaussian } from './rng';
import type { BreedCheck, BreedResult } from './api';

const RARITY_RANK: Record<'common' | 'rare' | 'epic', number> = {
  common: 1,
  rare: 2,
  epic: 3,
};

const GENE_KEYS = ['hp', 'atk', 'def', 'spd'] as const;

function traitRank(cfg: ConfigRepo, traitId: Id): number {
  const trait = cfg.allTraits().find((item) => item.id === traitId);
  return trait ? RARITY_RANK[trait.rarity] : 0;
}

function sortByRarity(cfg: ConfigRepo, list: Id[]): Id[] {
  // 稳定排序：同稀有度保持继承顺序。
  return [...list].sort((a, b) => traitRank(cfg, b) - traitRank(cfg, a));
}

function capTraits(cfg: ConfigRepo, list: Id[], max: number): Id[] {
  if (list.length <= max) return list;
  return sortByRarity(cfg, list).slice(0, max);
}

function dedupe(list: readonly Id[]): Id[] {
  return Array.from(new Set(list));
}

/** 双方及 `maxDepth` 代内祖先是否有交集（默认 3 代，DOMAIN §8.3）。 */
export function isInbredImpl(a: PetInstance, b: PetInstance, maxDepth: number): boolean {
  const aSet = new Set<Id>([a.id]);
  for (const ref of a.ancestors) {
    if (ref.depth <= maxDepth) aSet.add(ref.id);
  }
  const bSet = new Set<Id>([b.id]);
  for (const ref of b.ancestors) {
    if (ref.depth <= maxDepth) bSet.add(ref.id);
  }
  for (const id of aSet) {
    if (bSet.has(id)) return true;
  }
  return false;
}

function ancestorsOf(a: PetInstance, b: PetInstance, maxDepth: number): AncestorRef[] {
  const out: AncestorRef[] = [
    { id: a.id, depth: 1 },
    { id: b.id, depth: 1 },
  ];
  for (const parent of [a, b]) {
    for (const ref of parent.ancestors) {
      const depth = ref.depth + 1;
      if (depth <= maxDepth) out.push({ id: ref.id, depth });
    }
  }
  // 去重保留最小深度（DOMAIN §8.4）。
  const best = new Map<Id, number>();
  for (const ref of out) {
    const current = best.get(ref.id);
    if (current === undefined || ref.depth < current) best.set(ref.id, ref.depth);
  }
  const result: AncestorRef[] = [];
  for (const [id, depth] of best) result.push({ id, depth });
  return result;
}

function inEggStage(stage: PetInstance['stage']): boolean {
  return stage === 'egg' || stage === 'juvenile';
}

/** 存档内所有栖息地实例的当前容量之和。 */
export function profileCapacity(profile: Profile, cfg: ConfigRepo): number {
  let capacity = 0;
  for (const habitat of Object.values(profile.habitats)) {
    const config = cfg.habitat(habitat.configId);
    const level = config.upgrade.levels.find((entry) => entry.level === habitat.level);
    capacity += level ? level.capacity : config.capacity;
  }
  return capacity;
}

function canAfford(
  currencies: Record<string, number>,
  cost: readonly { resource: string; amount: number }[],
): boolean {
  for (const item of cost) {
    if ((currencies[item.resource] ?? 0) < item.amount) return false;
  }
  return true;
}

export function checkBreedingImpl(
  a: PetInstance,
  b: PetInstance,
  now: EpochMs,
  profile: Profile,
  cfg: ConfigRepo,
): BreedCheck {
  const inbred = isInbredImpl(a, b, cfg.breeding().inbreeding.generations);
  if (a.id === b.id) return { ok: false, reason: 'same_pet', inbred };
  if (a.gender === b.gender) return { ok: false, reason: 'same_gender', inbred };
  if (inEggStage(a.stage) || inEggStage(b.stage)) {
    return { ok: false, reason: 'not_adult', inbred };
  }
  if (a.locked || b.locked) return { ok: false, reason: 'locked', inbred };
  if (!cfg.species(a.speciesId).breedable || !cfg.species(b.speciesId).breedable) {
    return { ok: false, reason: 'infertile', inbred };
  }

  if (now < a.fertility.readyAt || now < b.fertility.readyAt) {
    return { ok: false, reason: 'infertile', inbred };
  }
  const aCooldown = Math.max(a.fertility.cooldownUntil, profile.breeding.cooldowns[a.id] ?? 0);
  const bCooldown = Math.max(b.fertility.cooldownUntil, profile.breeding.cooldowns[b.id] ?? 0);
  if (now < aCooldown || now < bCooldown) return { ok: false, reason: 'cooldown', inbred };

  const occupied = Object.keys(profile.pets).length + profile.breeding.eggs.length;
  if (occupied >= profileCapacity(profile, cfg)) return { ok: false, reason: 'no_capacity', inbred };

  if (!canAfford(profile.currencies, cfg.breeding().cost)) {
    return { ok: false, reason: 'cost', inbred };
  }

  return { ok: true, inbred };
}

function buildAlleles(expressed: readonly Id[], hidden: readonly Id[]): TraitAllele[] {
  return [
    ...expressed.map((traitId) => ({ traitId, dominant: true })),
    ...hidden.map((traitId) => ({ traitId, dominant: false })),
  ];
}

export function breedImpl(
  a: PetInstance,
  b: PetInstance,
  now: EpochMs,
  cfg: ConfigRepo,
  rng: Rng,
): BreedResult {
  const breeding = cfg.breeding();
  const inbred = isInbredImpl(a, b, breeding.inbreeding.generations);

  // 1. 物种：父母之一
  const speciesId = rng.pick([a.speciesId, b.speciesId]);

  // 2. 属性：父母之一；小概率突变
  let mutations = 0;
  let elementId = rng.pick([a.elementId, b.elementId]);
  if (rng.chance(breeding.mutation.elementChance)) {
    elementId = rng.pick(cfg.allElements().map((element) => element.id));
    mutations += 1;
  }

  // 3. 基因：父母均值 + Irwin–Hall 波动 + 近亲惩罚
  const stats: Genome['stats'] = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const key of GENE_KEYS) {
    const mean = (a.genome.stats[key] + b.genome.stats[key]) / 2;
    let gene = mean + gaussian(rng) * breeding.mutation.geneSigma;
    if (inbred) gene -= breeding.inbreeding.genePenalty;
    stats[key] = Math.min(100, Math.max(0, Math.round(gene)));
  }

  // 4. 特质：显性优先，隐性按 50% 保留
  const pool: TraitAllele[] = [
    ...a.traits.map((traitId) => ({ traitId, dominant: true })),
    ...a.hiddenTraits.map((traitId) => ({ traitId, dominant: false })),
    ...b.traits.map((traitId) => ({ traitId, dominant: true })),
    ...b.hiddenTraits.map((traitId) => ({ traitId, dominant: false })),
  ];
  const order: Id[] = [];
  const byTrait = new Map<Id, TraitAllele[]>();
  for (const allele of pool) {
    let group = byTrait.get(allele.traitId);
    if (!group) {
      group = [];
      byTrait.set(allele.traitId, group);
      order.push(allele.traitId);
    }
    group.push(allele);
  }

  const expressed: Id[] = [];
  const hidden: Id[] = [];
  for (const traitId of order) {
    const alleles = byTrait.get(traitId) ?? [];
    if (alleles.some((allele) => allele.dominant)) {
      expressed.push(traitId);
    } else if (rng.chance(0.5)) {
      hidden.push(traitId);
    }
  }

  const owned = new Set<Id>([...expressed, ...hidden]);
  const available = cfg.allTraits().filter((trait) => !owned.has(trait.id));
  const mutationChance =
    breeding.mutation.traitChance + (inbred ? breeding.inbreeding.mutationBonus : 0);
  if (available.length > 0 && rng.chance(mutationChance)) {
    expressed.push(rng.pick(available).id);
    mutations += 1;
  }

  const traits = dedupe(capTraits(cfg, expressed, breeding.maxExpressedTraits));
  const hiddenTraits = dedupe(capTraits(cfg, hidden, breeding.maxHiddenTraits));

  // 5. 代数与祖先
  const generation = Math.max(a.generation, b.generation) + 1;
  const ancestors = ancestorsOf(a, b, breeding.inbreeding.generations);

  // 6. 性别与出生时间
  const gender = rng.chance(0.5) ? 'male' : 'female';
  const bornAt = now;
  const hatchAt = now + breeding.hatchMs;

  const child: PetInstance = {
    // 正式 ID 由服务器生成；这里给确定性临时 ID，便于单机/测试复现。
    id: `egg_${a.id}_${b.id}_${now}`,
    speciesId,
    elementId,
    genome: {
      stats,
      speciesAlleles: [a.speciesId, b.speciesId],
      elementAlleles: [a.elementId, b.elementId],
      traitAlleles: buildAlleles(traits, hiddenTraits),
      mutationCount: mutations,
    },
    traits,
    hiddenTraits,
    gender,
    generation,
    parents: [a.id, b.id],
    ancestors,
    bornAt,
    stage: 'egg',
    stageChangedAt: bornAt,
    level: 1,
    exp: 0,
    condition: { hunger: 100, mood: 100, hygiene: 100, health: 100 },
    fertility: {
      readyAt: hatchAt + breeding.juvenileMs,
      cooldownUntil: 0,
      penalty: inbred ? breeding.inbreeding.fertilityPenalty : 0,
    },
    habitatId: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };

  // 父母冷却（contract-v1.2 D-02）：普通 ×(1+近亲惩罚) ×(老年 ×2)，按 [a, b] 顺序返回。
  const parentCooldowns: [EpochMs, EpochMs] = [
    now + breedingCooldownMs(a, inbred, cfg),
    now + breedingCooldownMs(b, inbred, cfg),
  ];

  return { child, inbred, parentCooldowns };
}

/**
 * 繁殖后单只父母的冷却时长：`cooldownMs × (1 + 近亲惩罚) × (老年 ×2)`（DOMAIN §8.3）。
 * 结果由 `breed` 的 `parentCooldowns` 返回，服务端直接落库。
 */
export function breedingCooldownMs(
  parent: PetInstance,
  inbred: boolean,
  cfg: ConfigRepo,
): number {
  const breeding = cfg.breeding();
  const penalty = inbred ? breeding.inbreeding.fertilityPenalty : 0;
  const elderMul = parent.stage === 'elder' ? 2 : 1;
  return Math.floor(breeding.cooldownMs * (1 + penalty) * elderMul);
}
