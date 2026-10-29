// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * 放生（DOMAIN_MODEL §8.6，PITFALLS P-026/P-035）。
 *
 * 五类拒绝：蛋 / 锁定 / 上阵 / 栖息地中 / 最后一只成年（成年或老年）。
 * 放生返还基因尘；图鉴 `owned` 不回退；宠物不死亡。
 *
 * `releasePet(profile, petId, now, cfg)`（contract-v1.2 D-01）：返还按
 * `economy.releaseRefund` 全量计算（base / perLevel / perGeneSumDivisor / rarityBonus）。
 */
import { ReleaseError } from './errors';
import type { ConfigRepo } from './config/types';
import type { PetId, PetInstance } from './types/pet';
import type { Profile } from './types/profile';
import type { EpochMs, Id } from './types/common';
import type { ReleaseResult } from './api';

/** 已表达特质的稀有度加成；配置里已删除的特质按 0 计（旧档兼容）。 */
function traitRarityBonus(
  pet: PetInstance,
  cfg: ConfigRepo,
  rarityBonus: Record<'common' | 'rare' | 'epic', number>,
): number {
  const rarityOf = new Map<Id, 'common' | 'rare' | 'epic'>();
  for (const trait of cfg.allTraits()) rarityOf.set(trait.id, trait.rarity);

  let bonus = 0;
  for (const traitId of pet.traits) {
    const rarity = rarityOf.get(traitId);
    if (rarity) bonus += rarityBonus[rarity];
  }
  return bonus;
}

function releaseValue(pet: PetInstance, cfg: ConfigRepo): number {
  const refund = cfg.economy().releaseRefund;
  const geneSum =
    pet.genome.stats.hp +
    pet.genome.stats.atk +
    pet.genome.stats.def +
    pet.genome.stats.spd;
  const raw =
    refund.base +
    pet.level * refund.perLevel +
    geneSum / refund.perGeneSumDivisor +
    traitRarityBonus(pet, cfg, refund.rarityBonus);
  return Math.max(1, Math.floor(raw));
}

function countAdults(pets: Record<PetId, PetInstance>): number {
  let count = 0;
  for (const pet of Object.values(pets)) {
    if (pet.stage === 'adult' || pet.stage === 'elder') count += 1;
  }
  return count;
}

export function releasePetImpl(
  profile: Profile,
  petId: PetId,
  _now: EpochMs,
  cfg: ConfigRepo,
): ReleaseResult {
  const pet = profile.pets[petId];
  if (!pet) throw new ReleaseError('pet_not_found');
  if (pet.stage === 'egg') throw new ReleaseError('cannot_release_egg');
  if (pet.locked) throw new ReleaseError('pet_locked');
  if (profile.lineup.includes(petId)) throw new ReleaseError('in_lineup');

  const inHabitat =
    pet.habitatId != null ||
    Object.values(profile.habitats).some((habitat) => habitat.slots.includes(petId));
  if (inHabitat) throw new ReleaseError('in_habitat');

  if ((pet.stage === 'adult' || pet.stage === 'elder') && countAdults(profile.pets) <= 1) {
    throw new ReleaseError('last_adult');
  }

  const refund = { geneDust: releaseValue(pet, cfg) };
  const pets: Profile['pets'] = { ...profile.pets };
  delete pets[petId];

  return {
    profile: {
      ...profile,
      pets,
      stats: { ...profile.stats, released: profile.stats.released + 1 },
    },
    refund,
  };
}
