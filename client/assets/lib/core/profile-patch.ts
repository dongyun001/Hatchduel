// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 存档增量（`ProfilePatch`）的应用与构造（contract-v1.4 D-16，PITFALLS P-047）。
 *
 * 应用规则：
 * - `pets` / `habitats`：先 upsert 再 remove，**remove 优先**（同一 id 两边出现时删除生效）；
 * - `currencies`：patch 里的每个资源是**绝对值**，直接覆盖同名字段（不做累加），未出现的资源保持原值；
 * - `codex`：只允许 `false → true`，`bestGene` 取较大值，不会因放生/回退而变小；
 * - `lineup / stageProgress / breeding / pvp / settings / stats`：整体替换；
 * - `revision` 取 `patch.toRevision`，`lastEvaluatedAt` 取 patch 值；不校验 `fromRevision`（调用方负责）；
 * - 不修改入参 `profile` / `patch`。
 */
import type { CodexEntry, CodexKey, Profile, ProfilePatch } from './types/profile';

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function applyProfilePatchImpl(profile: Profile, patch: ProfilePatch): Profile {
  const next: Profile = {
    ...profile,
    revision: patch.toRevision,
    lastEvaluatedAt: patch.lastEvaluatedAt,
  };

  if (patch.currencies !== undefined) {
    next.currencies = { ...profile.currencies, ...patch.currencies };
  }

  // 始终复制容器：即使 patch 没带 pets/habitats，也返回与入参不共享引用的存档。
  const pets = { ...profile.pets };
  if (patch.pets !== undefined) {
    for (const pet of patch.pets.upsert ?? []) pets[pet.id] = pet;
    // remove 优先：先删后不再补回（upsert 已经在上面写入，删除会覆盖）。
    for (const petId of patch.pets.remove ?? []) delete pets[petId];
  }
  next.pets = pets;

  const habitats = { ...profile.habitats };
  if (patch.habitats !== undefined) {
    for (const habitat of patch.habitats.upsert ?? []) habitats[habitat.id] = habitat;
    for (const habitatId of patch.habitats.remove ?? []) delete habitats[habitatId];
  }
  next.habitats = habitats;

  if (patch.codex !== undefined) {
    const codex = { ...profile.codex };
    for (const [rawKey, entry] of Object.entries(patch.codex)) {
      const key = rawKey as CodexKey;
      const previous: CodexEntry | undefined = codex[key];
      codex[key] = previous
        ? {
            seen: previous.seen || entry.seen,
            owned: previous.owned || entry.owned,
            bestGene: Math.max(previous.bestGene, entry.bestGene),
          }
        : { ...entry };
    }
    next.codex = codex;
  }

  if (patch.lineup !== undefined) next.lineup = [...patch.lineup];
  if (patch.stageProgress !== undefined) next.stageProgress = { ...patch.stageProgress };
  if (patch.breeding !== undefined) {
    next.breeding = { eggs: [...patch.breeding.eggs], cooldowns: { ...patch.breeding.cooldowns } };
  }
  if (patch.pvp !== undefined) {
    next.pvp = { ...patch.pvp, defense: [...patch.pvp.defense] };
  }
  if (patch.settings !== undefined) next.settings = { ...patch.settings };
  if (patch.stats !== undefined) next.stats = { ...patch.stats };

  return next;
}

function upsertById<T extends { id: string }>(
  before: Record<string, T>,
  after: Record<string, T>,
): { upsert?: T[]; remove?: string[] } {
  const upsert: T[] = [];
  for (const [id, item] of Object.entries(after)) {
    const previous = before[id];
    if (!previous || !sameJson(previous, item)) upsert.push(item);
  }
  const remove = Object.keys(before).filter((id) => after[id] === undefined);
  return {
    ...(upsert.length > 0 ? { upsert } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  };
}

/**
 * 由前后两份存档构造 patch（供 core 内部写操作用）。
 * `fromRevision = toRevision = before.revision`：revision 由服务端写操作统一 +1。
 */
export function buildProfilePatch(
  before: Profile,
  after: Profile,
  at: number,
): ProfilePatch {
  const patch: ProfilePatch = {
    fromRevision: before.revision,
    toRevision: before.revision,
    at,
    lastEvaluatedAt: after.lastEvaluatedAt,
  };

  if (!sameJson(before.currencies, after.currencies)) patch.currencies = after.currencies;

  const pets = upsertById(before.pets, after.pets);
  if (pets.upsert || pets.remove) patch.pets = pets;

  const habitats = upsertById(before.habitats, after.habitats);
  if (habitats.upsert || habitats.remove) patch.habitats = habitats;

  if (!sameJson(before.codex, after.codex)) patch.codex = after.codex;
  if (!sameJson(before.lineup, after.lineup)) patch.lineup = [...after.lineup];
  if (!sameJson(before.stageProgress, after.stageProgress)) {
    patch.stageProgress = { ...after.stageProgress };
  }
  if (!sameJson(before.breeding, after.breeding)) {
    patch.breeding = { eggs: [...after.breeding.eggs], cooldowns: { ...after.breeding.cooldowns } };
  }
  if (!sameJson(before.pvp, after.pvp)) {
    patch.pvp = { ...after.pvp, defense: [...after.pvp.defense] };
  }
  if (!sameJson(before.settings, after.settings)) patch.settings = { ...after.settings };
  if (!sameJson(before.stats, after.stats)) patch.stats = { ...after.stats };

  return patch;
}
