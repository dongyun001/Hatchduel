/**
 * 存档增量（`ProfilePatch`）组合。
 *
 * 一次写操作会产生两份变更：
 * 1. core 的 `advanceProfile` 推进结果（时间驱动的阶段/状态/产出）；
 * 2. 端点自己的改动（改名、领取、编队……）。
 *
 * 两份合并成一份下发给客户端；revision 由服务端统一递增，所以 `fromRevision/toRevision`
 * 与 `at/lastEvaluatedAt` 在这里覆写，其余字段按“端点覆盖推进结果”合并。
 */
import type { HabitatInstance, PetInstance, Profile, ProfilePatch } from '@petbattle/core';

type PetsPatch = NonNullable<ProfilePatch['pets']>;
type HabitatsPatch = NonNullable<ProfilePatch['habitats']>;

export interface PatchRevisions {
  from: number;
  to: number;
  at: number;
  lastEvaluatedAt: number;
}

function mergePets(base: PetsPatch | undefined, extra: PetsPatch | undefined): PetsPatch | undefined {
  if (base === undefined && extra === undefined) return undefined;
  const upsert = new Map<string, PetInstance>();
  for (const pet of base?.upsert ?? []) upsert.set(pet.id, pet);
  for (const pet of extra?.upsert ?? []) upsert.set(pet.id, pet);
  const remove = new Set<string>([...(base?.remove ?? []), ...(extra?.remove ?? [])]);
  // remove 优先：放生时 core 的推进增量可能刚好 upsert 了同一只，
  // 若两者同时下发，客户端会看到“删了又复活”的歧义。
  return { upsert: [...upsert.values()].filter((pet) => !remove.has(pet.id)), remove: [...remove] };
}

function mergeHabitats(
  base: HabitatsPatch | undefined,
  extra: HabitatsPatch | undefined,
): HabitatsPatch | undefined {
  if (base === undefined && extra === undefined) return undefined;
  const upsert = new Map<string, HabitatInstance>();
  for (const habitat of base?.upsert ?? []) upsert.set(habitat.id, habitat);
  for (const habitat of extra?.upsert ?? []) upsert.set(habitat.id, habitat);
  const remove = new Set<string>([...(base?.remove ?? []), ...(extra?.remove ?? [])]);
  return {
    upsert: [...upsert.values()].filter((habitat) => !remove.has(habitat.id)),
    remove: [...remove],
  };
}

export function composePatch(
  base: ProfilePatch,
  extra: Partial<ProfilePatch> | undefined,
  revisions: PatchRevisions,
): ProfilePatch {
  const composed: ProfilePatch = {
    ...base,
    ...extra,
    fromRevision: revisions.from,
    toRevision: revisions.to,
    at: revisions.at,
    lastEvaluatedAt: revisions.lastEvaluatedAt,
  };

  const pets = mergePets(base.pets, extra?.pets);
  if (pets !== undefined) composed.pets = pets;

  const habitats = mergeHabitats(base.habitats, extra?.habitats);
  if (habitats !== undefined) composed.habitats = habitats;

  return composed;
}

/** core 尚未实现时的恒等推进：不改数据，只保留 revision/时间语义。 */
export function identityPatch(profile: Profile, at: number): ProfilePatch {
  return {
    fromRevision: profile.revision,
    toRevision: profile.revision,
    at,
    lastEvaluatedAt: profile.lastEvaluatedAt,
  };
}
