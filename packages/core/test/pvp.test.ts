import { describe, expect, it } from 'vitest';

import {
  BattleEngine,
  DEFENSE_SNAPSHOT_TTL_MS,
  DefenseError,
  MAX_LINEUP_SIZE,
  applyProfilePatch,
  applyPvpOutcome,
  buildBattleSetup,
  buildDefenseSnapshot,
  buildPvpBattleSetup,
  type BattleEvent,
  type BattleSetup,
  type ConfigRepo,
  type Profile,
} from '@petbattle/core';

import { T0, makePet, makeProfile } from './factory.js';
import { makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();

/** 合成配置 + 给鱼加物种被动，用于验证快照与 buildBattleSetup 的被动口径一致。 */
const cfgWithPassive = makeSyntheticRepo((config) => {
  const species = config['species'] as Record<string, unknown>[];
  const fish = species.find((item) => item['id'] === 'fish');
  if (!fish) throw new Error('missing fish species');
  fish['passiveId'] = 'passive_synth';

  const passives = config['passives'] as Record<string, unknown>[];
  passives[0]!['statMods'] = { atk: 1.2 };
});

function samplePets() {
  return [
    makePet({ id: 'p1', speciesId: 'fish', elementId: 'water', level: 4 }),
    makePet({ id: 'p2', speciesId: 'turtle', elementId: 'earth', level: 3 }),
    makePet({ id: 'p3', speciesId: 'frog', elementId: 'grass', level: 2 }),
  ];
}

function sampleProfile(count = 2): Profile {
  return makeProfile(samplePets().slice(0, count));
}

function expectDefenseError(fn: () => unknown, reason: DefenseError['reason']): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DefenseError);
  expect((caught as DefenseError).reason).toBe(reason);
}

/** FNV-1a 32 位指纹；事件流确定性回归用（完整 JSON 也会比对）。 */
function digest(events: readonly BattleEvent[]): string {
  const text = JSON.stringify(events);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function playToEnd(
  setup: BattleSetup,
  repo: ConfigRepo,
): { winner: 0 | 1 | null; log: BattleEvent[] } {
  const engine = BattleEngine.create(setup, repo);
  let guard = 0;
  while (engine.state.phase === 'ongoing' && guard < 500) {
    const actor = engine.state.order[engine.state.cursor]!;
    engine.submit(engine.autoCommand(actor));
    guard += 1;
  }
  return { winner: engine.state.winner, log: engine.state.log };
}

describe('buildDefenseSnapshot（contract-v1.6 F-01/F-09）', () => {
  it('petIds 顺序即出场顺序，uid 固定 d0/d1，TTL 24h', () => {
    const profile = sampleProfile(2);
    const snapshot = buildDefenseSnapshot(profile, ['p2', 'p1'], T0, cfg);

    expect(snapshot.petIds).toEqual(['p2', 'p1']);
    expect(snapshot.units.map((unit) => unit.uid)).toEqual(['d0', 'd1']);
    expect(snapshot.units.map((unit) => unit.petId)).toEqual(['p2', 'p1']);
    expect(snapshot.contentVersion).toBe(cfg.contentVersion);
    expect(snapshot.createdAt).toBe(T0);
    expect(snapshot.expiresAt).toBe(T0 + DEFENSE_SNAPSHOT_TTL_MS);
    expect(DEFENSE_SNAPSHOT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('stats / skills / traits / passiveId 与 buildBattleSetup 同口径', () => {
    const profile = sampleProfile(3);
    const petIds = ['p1', 'p2', 'p3'];
    const snapshot = buildDefenseSnapshot(profile, petIds, T0, cfgWithPassive);
    const party = petIds.map((id) => profile.pets[id]!);
    const expected = buildBattleSetup([party, []], cfgWithPassive, 11).teams[0];

    expect(snapshot.units).toHaveLength(expected.length);
    snapshot.units.forEach((unit, index) => {
      const reference = expected[index]!;
      expect(unit.stats).toEqual(reference.stats);
      expect(unit.skills).toEqual(reference.skills);
      expect(unit.traits).toEqual(reference.traits);
      expect(unit.passiveId).toBe(reference.passiveId);
      expect(unit.speciesId).toBe(reference.speciesId);
      expect(unit.elementId).toBe(reference.elementId);
      expect(unit.level).toBe(reference.level);
    });
    // 鱼的被动确实进入了快照（避免“两边都没有 passiveId”导致假通过）。
    expect(snapshot.units[0]!.passiveId).toBe('passive_synth');
  });

  it('空阵容 / 超过 3 只 → invalid_count', () => {
    const profile = sampleProfile(3);
    expectDefenseError(() => buildDefenseSnapshot(profile, [], T0, cfg), 'invalid_count');
    expectDefenseError(
      () => buildDefenseSnapshot(profile, ['p1', 'p2', 'p3', 'p1'], T0, cfg),
      'invalid_count',
    );
    expect(MAX_LINEUP_SIZE).toBe(3);
  });

  it('重复宠物 → duplicate', () => {
    const profile = sampleProfile(2);
    expectDefenseError(() => buildDefenseSnapshot(profile, ['p1', 'p1'], T0, cfg), 'duplicate');
    // 重复优先于“不存在”：契约检查顺序是 数量 → 重复 → 存在 → 非蛋。
    expectDefenseError(
      () => buildDefenseSnapshot(profile, ['ghost', 'ghost'], T0, cfg),
      'duplicate',
    );
  });

  it('不存在的宠物 → pet_not_found', () => {
    const profile = sampleProfile(2);
    expectDefenseError(
      () => buildDefenseSnapshot(profile, ['p1', 'ghost'], T0, cfg),
      'pet_not_found',
    );
  });

  it('蛋 → pet_is_egg（锁定不阻止进防守）', () => {
    const egg = makePet({ id: 'egg_1', stage: 'egg' });
    const locked = makePet({ id: 'locked_1', speciesId: 'turtle', locked: true });
    const profile = makeProfile([egg, locked]);

    expectDefenseError(() => buildDefenseSnapshot(profile, ['egg_1'], T0, cfg), 'pet_is_egg');
    const snapshot = buildDefenseSnapshot(profile, ['locked_1'], T0, cfg);
    expect(snapshot.units[0]!.petId).toBe('locked_1');
  });

  it('纯函数：不改 profile / pets，petIds 返回新数组', () => {
    const profile = sampleProfile(2);
    const before = JSON.stringify(profile);
    const ids = ['p1', 'p2'];
    const snapshot = buildDefenseSnapshot(profile, ids, T0, cfg);

    expect(JSON.stringify(profile)).toBe(before);
    expect(snapshot.petIds).not.toBe(ids);
    // units 的属性容器不共享引用（快照可落库序列化，后续改动不回溯）。
    snapshot.units[0]!.stats.atk += 1;
    expect(JSON.stringify(profile)).toBe(before);
  });
});

describe('buildPvpBattleSetup（contract-v1.6 F-03/F-09）', () => {
  it('team0 = 攻方（a*），team1 = 防守（d* 重排为 b*）', () => {
    const defender = sampleProfile(2);
    const attacker = samplePets().slice(1, 3);
    const snapshot = buildDefenseSnapshot(defender, ['p1', 'p2'], T0, cfg);
    const setup = buildPvpBattleSetup(attacker, snapshot.units, cfg, 2024);

    expect(setup.seed).toBe(2024);
    expect(setup.teams[0].map((unit) => unit.uid)).toEqual(['a0', 'a1']);
    expect(setup.teams[1].map((unit) => unit.uid)).toEqual(['b0', 'b1']);
    expect(setup.teams[0].map((unit) => unit.petId)).toEqual(['p2', 'p3']);
    expect(setup.teams[1].map((unit) => unit.petId)).toEqual(
      snapshot.units.map((unit) => unit.petId),
    );

    const allUids = [...setup.teams[0], ...setup.teams[1]].map((unit) => unit.uid);
    expect(new Set(allUids).size).toBe(allUids.length);
    expect(allUids.filter((uid) => uid.startsWith('a'))).toHaveLength(2);
    expect(allUids.filter((uid) => uid.startsWith('b'))).toHaveLength(2);
  });

  it('防守快照的属性/技能/特质原样带入，且不共享容器引用', () => {
    const profile = sampleProfile(2);
    const snapshot = buildDefenseSnapshot(profile, ['p1', 'p2'], T0, cfg);
    const setup = buildPvpBattleSetup(samplePets(), snapshot.units, cfg, 1);

    snapshot.units.forEach((unit, index) => {
      const copied = setup.teams[1][index]!;
      expect(copied.stats).toEqual(unit.stats);
      expect(copied.skills).toEqual(unit.skills);
      expect(copied.traits).toEqual(unit.traits);
      expect(copied.stats).not.toBe(unit.stats);
      expect(copied.skills).not.toBe(unit.skills);
    });
  });

  it('不改入参数组', () => {
    const profile = sampleProfile(2);
    const snapshot = buildDefenseSnapshot(profile, ['p1', 'p2'], T0, cfg);
    const attackers = samplePets().slice(0, 2);
    const unitsBefore = JSON.stringify(snapshot.units);
    const attackersBefore = JSON.stringify(attackers);

    buildPvpBattleSetup(attackers, snapshot.units, cfg, 9);

    expect(snapshot.units[0]!.uid).toBe('d0');
    expect(snapshot.units[1]!.uid).toBe('d1');
    expect(JSON.stringify(snapshot.units)).toBe(unitsBefore);
    expect(JSON.stringify(attackers)).toBe(attackersBefore);
  });

  it('空队 / 超过 3 只都抛错', () => {
    const profile = sampleProfile(2);
    const units = buildDefenseSnapshot(profile, ['p1', 'p2'], T0, cfg).units;
    const four = samplePets().concat(makePet({ id: 'p4', speciesId: 'fish' }));

    expect(() => buildPvpBattleSetup([], units, cfg, 1)).toThrow(/1~3/);
    expect(() => buildPvpBattleSetup(four, units, cfg, 1)).toThrow(/1~3/);
    expect(() => buildPvpBattleSetup(samplePets(), [], cfg, 1)).toThrow(/1~3/);
    expect(() => buildPvpBattleSetup(samplePets(), units.concat(units), cfg, 1)).toThrow(/1~3/);
  });

  it('同 setup/seed 双跑：事件指纹与结果一致', () => {
    const profile = sampleProfile(3);
    const attackers = samplePets().slice(0, 2);

    const build = () => {
      const snapshot = buildDefenseSnapshot(profile, ['p1', 'p2', 'p3'], T0, cfg);
      return buildPvpBattleSetup(attackers, snapshot.units, cfg, 424242);
    };

    const first = playToEnd(build(), cfg);
    const second = playToEnd(build(), cfg);

    expect(digest(second.log)).toBe(digest(first.log));
    expect(second.log).toEqual(first.log);
    expect(second.winner).toBe(first.winner);
    expect(first.log.at(-1)!.type).toBe('battleEnd');
  });
});

describe('applyPvpOutcome（contract-v1.6 F-09）', () => {
  it('真人排位胜：写入 rating、ranked.wins +1、battlesWon +1', () => {
    const profile = makeProfile(samplePets());
    const result = applyPvpOutcome(profile, {
      result: 'win',
      ranked: true,
      ratingAfter: 1016,
      seasonId: 's1',
    });

    expect(result.profile.pvp.rating).toBe(1016);
    expect(result.profile.pvp.ranked).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(result.profile.stats.battlesWon).toBe(1);
    expect(result.profile.stats.battlesLost).toBe(0);
    expect(result.profile.pvp.seasonId).toBe('s1');
  });

  it('真人排位负：通过既有 ranked 累加，battlesLost +1', () => {
    const profile = makeProfile(samplePets());
    profile.pvp = {
      defense: [],
      rating: 1100,
      seasonId: 's1',
      ranked: { wins: 2, losses: 1, draws: 1 },
    };

    const result = applyPvpOutcome(profile, {
      result: 'loss',
      ranked: true,
      ratingAfter: 1076,
      seasonId: 's1',
    });

    expect(result.profile.pvp.rating).toBe(1076);
    expect(result.profile.pvp.ranked).toEqual({ wins: 2, losses: 2, draws: 1 });
    expect(result.profile.stats.battlesWon).toBe(0);
    expect(result.profile.stats.battlesLost).toBe(1);
  });

  it('真人排位平：ranked.draws +1，battlesWon/Lost 都不计', () => {
    const profile = makeProfile(samplePets());
    const result = applyPvpOutcome(profile, {
      result: 'draw',
      ranked: true,
      ratingAfter: 1000,
      seasonId: 's1',
    });

    expect(result.profile.pvp.ranked).toEqual({ wins: 0, losses: 0, draws: 1 });
    expect(result.profile.stats.battlesWon).toBe(0);
    expect(result.profile.stats.battlesLost).toBe(0);
  });

  it('机器人（ranked=false）：rating 不变、ranked 不计数，stats 仍计', () => {
    const profile = makeProfile(samplePets());
    const result = applyPvpOutcome(profile, {
      result: 'win',
      ranked: false,
      ratingAfter: profile.pvp.rating,
      seasonId: 's1',
    });

    expect(result.profile.pvp.rating).toBe(1000);
    expect(result.profile.pvp.ranked).toBeUndefined();
    expect('ranked' in result.profile.pvp).toBe(false);
    expect(result.profile.stats.battlesWon).toBe(1);
    expect(result.profile.stats.battlesLost).toBe(0);
  });

  it('机器人且已有排位战绩：计数原样保留（不新增）', () => {
    const profile = makeProfile(samplePets());
    profile.pvp = {
      defense: ['p1'],
      rating: 1234,
      seasonId: 's1',
      ranked: { wins: 5, losses: 3, draws: 2 },
    };

    const result = applyPvpOutcome(profile, {
      result: 'loss',
      ranked: false,
      ratingAfter: 1234,
      seasonId: 's1',
    });

    expect(result.profile.pvp.rating).toBe(1234);
    expect(result.profile.pvp.ranked).toEqual({ wins: 5, losses: 3, draws: 2 });
    expect(result.profile.pvp.ranked).not.toBe(profile.pvp.ranked);
    expect(result.profile.stats.battlesLost).toBe(1);
  });

  it('机器人却给了不同 rating → 显式抛错（不静默忽略）', () => {
    const profile = makeProfile(samplePets());
    expect(() =>
      applyPvpOutcome(profile, {
        result: 'win',
        ranked: false,
        ratingAfter: 1032,
        seasonId: 's1',
      }),
    ).toThrow(/ratingAfter/);
  });

  it('patch 形状：revision 不前移、时间不动、只带 pvp/stats', () => {
    const profile = makeProfile(samplePets());
    profile.revision = 7;
    const result = applyPvpOutcome(profile, {
      result: 'win',
      ranked: true,
      ratingAfter: 1024,
      seasonId: 's2',
    });

    expect(result.patch.fromRevision).toBe(7);
    expect(result.patch.toRevision).toBe(7);
    expect(result.patch.at).toBe(profile.lastEvaluatedAt);
    expect(result.patch.lastEvaluatedAt).toBe(profile.lastEvaluatedAt);
    expect(result.patch.pvp).toEqual(result.profile.pvp);
    expect(result.patch.stats).toEqual(result.profile.stats);
    expect(result.patch.pvp).not.toBe(result.profile.pvp);
    expect(result.patch.currencies).toBeUndefined();
    expect(result.patch.pets).toBeUndefined();
    expect(result.patch.habitats).toBeUndefined();
    expect(result.patch.lineup).toBeUndefined();

    expect(result.profile.revision).toBe(7);
    expect(result.profile.lastEvaluatedAt).toBe(profile.lastEvaluatedAt);
    // 换季：seasonId 始终写入 outcome 的值。
    expect(result.profile.pvp.seasonId).toBe('s2');
  });

  it('纯函数：不改入参，返回新 profile/pvp/ranked', () => {
    const profile = makeProfile(samplePets());
    profile.pvp = { defense: ['p1'], rating: 1000, seasonId: 's1' };
    const before = JSON.stringify(profile);

    const result = applyPvpOutcome(profile, {
      result: 'win',
      ranked: true,
      ratingAfter: 1016,
      seasonId: 's1',
    });

    expect(JSON.stringify(profile)).toBe(before);
    expect(result.profile).not.toBe(profile);
    expect(result.profile.pvp).not.toBe(profile.pvp);
    expect(result.profile.pvp.defense).not.toBe(profile.pvp.defense);
    expect(result.profile.pvp.ranked).not.toBe(profile.pvp.ranked);
    expect(result.profile.stats).not.toBe(profile.stats);
  });

  it('patch 可被 applyProfilePatch 还原（服务端落库后客户端合并一致）', () => {
    const profile = makeProfile(samplePets());
    const result = applyPvpOutcome(profile, {
      result: 'draw',
      ranked: true,
      ratingAfter: 1000,
      seasonId: 's1',
    });

    const merged = applyProfilePatch(profile, result.patch);
    expect(merged).toEqual(result.profile);
  });
});
