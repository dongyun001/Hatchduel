/**
 * 放生（DOMAIN_MODEL §8.6，PITFALLS P-026/P-035）。
 *
 * 五类拒绝：蛋 / 锁定 / 上阵 / 栖息地中 / 最后一只成年（成年或老年）。
 * 放生返还基因尘；图鉴 `owned` 不回退；宠物不死亡。
 *
 * 注意：契约签名 `releasePet(profile, petId, now)` 不带 `ConfigRepo`，
 * 因此返还公式暂用 DOMAIN §8.6 的字面参数（base 5 / 每级 2 / 基因和 ÷10），
 * 稀有特质加成拿不到 `TraitConfig.rarity`，按 0 计；待契约补 `cfg` 或 economy 入参。
 */
import { ReleaseError } from './errors.js';
import type { PetId, PetInstance } from './types/pet.js';
import type { Profile } from './types/profile.js';
import type { EpochMs } from './types/common.js';
import type { ReleaseResult } from './api.js';

/** DOMAIN §8.6 初版公式参数；与 data/economy.json 的 releaseRefund 对齐。 */
const RELEASE_REFUND = {
  base: 5,
  perLevel: 2,
  perGeneSumDivisor: 10,
} as const;

function releaseValue(pet: PetInstance): number {
  const geneSum =
    pet.genome.stats.hp +
    pet.genome.stats.atk +
    pet.genome.stats.def +
    pet.genome.stats.spd;
  const raw = RELEASE_REFUND.base + pet.level * RELEASE_REFUND.perLevel + geneSum / RELEASE_REFUND.perGeneSumDivisor;
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

  const refund = { geneDust: releaseValue(pet) };
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
