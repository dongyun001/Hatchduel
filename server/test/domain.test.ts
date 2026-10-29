import { describe, expect, it } from 'vitest';

import { CoreNotImplementedError } from '@petbattle/core';
import type { ConfigRepo, HabitatInstance, PetInstance, ProfilePatch } from '@petbattle/core';

import { createCoreAdapter } from '../src/domain/core-adapter.js';
import { composePatch, identityPatch } from '../src/domain/patch.js';
import { createInitialProfile } from '../src/domain/starter-profile.js';
import { silentLogger } from '../src/logger.js';

const pet = (id: string): PetInstance => ({ id }) as PetInstance;
const habitat = (id: string): HabitatInstance => ({ id }) as HabitatInstance;

describe('composePatch', () => {
  const base: ProfilePatch = {
    fromRevision: 3,
    toRevision: 3,
    at: 1000,
    lastEvaluatedAt: 1000,
    currencies: { coin: 10 },
    pets: { upsert: [pet('p1')] },
  };

  it('端点改动覆盖同名字段，revision/时间由服务端统一写入', () => {
    const merged = composePatch(
      base,
      { currencies: { coin: 99 }, lineup: ['p1'] },
      { from: 3, to: 4, at: 2000, lastEvaluatedAt: 2000 },
    );

    expect(merged.fromRevision).toBe(3);
    expect(merged.toRevision).toBe(4);
    expect(merged.at).toBe(2000);
    expect(merged.lastEvaluatedAt).toBe(2000);
    expect(merged.currencies).toEqual({ coin: 99 });
    expect(merged.lineup).toEqual(['p1']);
  });

  it('pets 的 upsert 按 id 去重，remove 并集', () => {
    const merged = composePatch(
      base,
      { pets: { upsert: [pet('p1'), pet('p2')], remove: ['p9'] } },
      { from: 3, to: 4, at: 2000, lastEvaluatedAt: 2000 },
    );

    const ids = merged.pets?.upsert?.map((entry) => entry.id) ?? [];
    expect(ids.sort()).toEqual(['p1', 'p2']);
    expect(merged.pets?.remove).toEqual(['p9']);
  });

  it('habitats 合并规则与 pets 一致', () => {
    const merged = composePatch(
      { ...base, habitats: { upsert: [habitat('h1')] } },
      { habitats: { upsert: [habitat('h2')], remove: ['h9'] } },
      { from: 3, to: 4, at: 2000, lastEvaluatedAt: 2000 },
    );

    expect(merged.habitats?.upsert?.map((entry) => entry.id).sort()).toEqual(['h1', 'h2']);
    expect(merged.habitats?.remove).toEqual(['h9']);
  });

  it('没有额外改动时只覆盖 revision/时间', () => {
    const merged = composePatch(base, undefined, {
      from: 3,
      to: 4,
      at: 2000,
      lastEvaluatedAt: 1000,
    });
    expect(merged.pets?.upsert).toHaveLength(1);
    expect(merged.toRevision).toBe(4);
  });
});

describe('identityPatch', () => {
  it('不改 revision，只回显时间戳', () => {
    const profile = createInitialProfile('acc_1', 500);
    const patch = identityPatch(profile, 900);
    expect(patch.fromRevision).toBe(0);
    expect(patch.toRevision).toBe(0);
    expect(patch.at).toBe(900);
    expect(patch.lastEvaluatedAt).toBe(500);
    expect(patch.currencies).toBeUndefined();
  });
});

describe('createCoreAdapter', () => {
  const profile = createInitialProfile('acc_1', 500);

  it('配置仓库不可用时降级为恒等推进并标记 degraded', () => {
    const adapter = createCoreAdapter({ allowStub: true, logger: silentLogger });
    const result = adapter.advanceProfile(profile, 900);

    expect(result.degraded).toBe(true);
    expect(result.profile).toBe(profile);
    expect(result.patch.toRevision).toBe(profile.revision);
    expect(adapter.degraded).toBe(true);
  });

  it('配置仓库可用且 core 已实现：正常推进，不降级', () => {
    const adapter = createCoreAdapter({
      allowStub: true,
      logger: silentLogger,
      configRepo: {} as ConfigRepo,
    });
    // 空存档不需要查配置表；A 交付后 core 不再抛 CoreNotImplementedError。
    const result = adapter.advanceProfile(profile, 900);
    expect(result.degraded).toBe(false);
    expect(result.profile.lastEvaluatedAt).toBe(900);
  });

  it('strict 模式下配置仓库不可用直接抛出，不静默降级', () => {
    const adapter = createCoreAdapter({ allowStub: false, logger: silentLogger });
    expect(() => adapter.advanceProfile(profile, 900)).toThrow(CoreNotImplementedError);
    expect(adapter.degraded).toBe(false);
  });
});
