import { describe, expect, it } from 'vitest';

import { applyProfilePatch, type ProfilePatch } from '@petbattle/core';

import { HOUR, T0, makePet, makeProfile } from './factory.js';

function barePatch(overrides: Partial<ProfilePatch> = {}): ProfilePatch {
  return {
    fromRevision: 1,
    toRevision: 1,
    at: T0,
    lastEvaluatedAt: T0,
    ...overrides,
  };
}

describe('applyProfilePatch（D-16）', () => {
  it('remove 优先于 upsert：同一 id 两边出现时删除生效（P-047）', () => {
    const pet = makePet({ id: 'p1' });
    const profile = makeProfile([pet], []);
    const patched = applyProfilePatch(
      profile,
      barePatch({ pets: { upsert: [{ ...pet, name: '改过名' }], remove: ['p1'] } }),
    );
    expect(patched.pets['p1']).toBeUndefined();
  });

  it('先 upsert 再 remove：其他宠物保留', () => {
    const keep = makePet({ id: 'keep' });
    const profile = makeProfile([keep], []);
    const added = makePet({ id: 'new' });
    const patched = applyProfilePatch(
      profile,
      barePatch({ pets: { upsert: [added], remove: [] } }),
    );
    expect(Object.keys(patched.pets).sort()).toEqual(['keep', 'new']);
  });

  it('currencies 是绝对值覆盖，不做累加；未出现的资源保持原值', () => {
    const profile = makeProfile([], []);
    profile.currencies = { coin: 100, food: 50, geneDust: 10, premium: 0 };

    const patched = applyProfilePatch(profile, barePatch({ currencies: { coin: 30 } }));
    expect(patched.currencies).toEqual({ coin: 30, food: 50, geneDust: 10, premium: 0 });
  });

  it('codex 只允许 false → true，bestGene 单调不减', () => {
    const profile = makeProfile([], []);
    profile.codex = { 'fish:water': { seen: true, owned: true, bestGene: 70 } };

    const regress = applyProfilePatch(
      profile,
      barePatch({
        codex: {
          'fish:water': { seen: false, owned: false, bestGene: 50 },
          'cat:fire': { seen: true, owned: false, bestGene: 60 },
        },
      }),
    );
    expect(regress.codex['fish:water']).toEqual({ seen: true, owned: true, bestGene: 70 });
    expect(regress.codex['cat:fire']).toEqual({ seen: true, owned: false, bestGene: 60 });

    const forward = applyProfilePatch(
      profile,
      barePatch({ codex: { 'fish:water': { seen: true, owned: true, bestGene: 90 } } }),
    );
    expect(forward.codex['fish:water']!.bestGene).toBe(90);
  });

  it('lineup / stageProgress / breeding / pvp / settings / stats 整体替换', () => {
    const profile = makeProfile([], []);
    profile.lineup = ['a'];
    profile.stageProgress = { stage_1: { cleared: true } };
    profile.breeding = { eggs: ['e1'], cooldowns: { x: 1 } };
    profile.pvp = { defense: ['d1'], rating: 1200, seasonId: 's1' };
    profile.settings = { sfx: true, bgm: true };
    profile.stats = { ...profile.stats, battlesWon: 5 };

    const patched = applyProfilePatch(
      profile,
      barePatch({
        lineup: ['b'],
        stageProgress: { stage_2: { cleared: true, bestTurns: 5 } },
        breeding: { eggs: [], cooldowns: {} },
        pvp: { defense: [], rating: 900, seasonId: 's2' },
        settings: { sfx: false, bgm: false },
        stats: { ...profile.stats, battlesWon: 9 },
      }),
    );

    expect(patched.lineup).toEqual(['b']);
    expect(patched.stageProgress).toEqual({ stage_2: { cleared: true, bestTurns: 5 } });
    expect(patched.breeding).toEqual({ eggs: [], cooldowns: {} });
    expect(patched.pvp).toEqual({ defense: [], rating: 900, seasonId: 's2' });
    expect(patched.settings).toEqual({ sfx: false, bgm: false });
    expect(patched.stats.battlesWon).toBe(9);
  });

  it('空 patch：只更新 revision / lastEvaluatedAt，其余深相等', () => {
    const pet = makePet({ id: 'p1' });
    const profile = makeProfile([pet], ['p1']);
    const at = T0 + HOUR;
    const patched = applyProfilePatch(profile, {
      fromRevision: 1,
      toRevision: 2,
      at,
      lastEvaluatedAt: at,
    });

    expect(patched.revision).toBe(2);
    expect(patched.lastEvaluatedAt).toBe(at);
    const { revision: _r1, lastEvaluatedAt: _l1, ...base } = profile;
    const { revision: _r2, lastEvaluatedAt: _l2, ...next } = patched;
    void _r1;
    void _l1;
    void _r2;
    void _l2;
    expect(next).toEqual(base);
  });

  it('不校验 fromRevision，revision 取 toRevision', () => {
    const profile = makeProfile([], []);
    const patched = applyProfilePatch(profile, {
      fromRevision: 999,
      toRevision: 7,
      at: T0,
      lastEvaluatedAt: T0,
    });
    expect(patched.revision).toBe(7);
  });

  it('不修改入参 profile 与 patch', () => {
    const pet = makePet({ id: 'p1' });
    const profile = makeProfile([pet], []);
    const patch = barePatch({ pets: { upsert: [{ ...pet, name: 'X' }], remove: [] } });
    const beforeProfile = JSON.stringify(profile);
    const beforePatch = JSON.stringify(patch);

    applyProfilePatch(profile, patch);
    expect(JSON.stringify(profile)).toBe(beforeProfile);
    expect(JSON.stringify(patch)).toBe(beforePatch);
  });

  it('habitats 同样 remove 优先', () => {
    const profile = makeProfile([], []);
    const habitat = profile.habitats['meadow']!;
    const patched = applyProfilePatch(
      profile,
      barePatch({ habitats: { upsert: [habitat], remove: ['meadow'] } }),
    );
    expect(patched.habitats['meadow']).toBeUndefined();
  });

  it('返回新对象（不共享 pets/habitats 引用）', () => {
    const profile = makeProfile([makePet({ id: 'p1' })], []);
    const patched = applyProfilePatch(profile, barePatch());
    expect(patched).not.toBe(profile);
    expect(patched.pets).not.toBe(profile.pets);
    expect(patched.habitats).not.toBe(profile.habitats);
  });
});
