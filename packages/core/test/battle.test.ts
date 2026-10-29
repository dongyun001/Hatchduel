import { describe, expect, it } from 'vitest';

import {
  BattleEngine,
  MAX_TURNS,
  buildBattleSetup,
  buildEnemyTeam,
  deriveStats,
  type BattleSetup,
  type BattleUnitInit,
  type Command,
  type StatBlock,
} from '@petbattle/core';

import { addPassive, addSkill, makePet, makeRepo, skillRow } from './factory.js';

interface UnitOptions {
  stats?: Partial<StatBlock>;
  speciesId?: string;
  elementId?: BattleUnitInit['elementId'];
  skills?: string[];
  passiveId?: string;
}

function makeUnit(uid: string, options: UnitOptions = {}): BattleUnitInit {
  return {
    uid,
    petId: `pet_${uid}`,
    speciesId: options.speciesId ?? 'fish',
    elementId: options.elementId ?? 'water',
    level: 1,
    stats: {
      // 默认高血量，避免攻击 400 的测试单位一回合被秒；需要短局的用例自行覆盖。
      hp: 10_000,
      atk: 400,
      def: 0,
      spd: 10,
      crit: 0,
      critDmg: 1.5,
      hit: 0.5,
      dodge: 0,
      ...options.stats,
    },
    skills: options.skills ?? ['normal_strike'],
    traits: [],
    ...(options.passiveId ? { passiveId: options.passiveId } : {}),
  };
}

function setupOf(a: BattleUnitInit, b: BattleUnitInit, seed = 1): BattleSetup {
  return { seed, teams: [[a], [b]] };
}

function normal(engine: BattleEngine, uid: string, target: string): Command {
  return { type: 'skill', turn: engine.state.turn, uid, skillId: 'normal_strike', targetUids: [target] };
}

function hitOf(events: ReturnType<BattleEngine['submit']>) {
  const hit = events.find((event) => event.type === 'hit');
  if (!hit || hit.type !== 'hit') throw new Error('expected hit event');
  return hit;
}

const cfg = makeRepo();

describe('buildBattleSetup（DOMAIN §9）', () => {
  it('生成 a0/b0 uid，stats 来自 deriveStats，技能顺序固定', () => {
    const pet = makePet({ id: 'p1', speciesId: 'fish', elementId: 'water' });
    const enemy = makePet({ id: 'p2', speciesId: 'turtle', elementId: 'earth' });
    const setup = buildBattleSetup([[pet], [enemy]], cfg, 42);

    expect(setup.seed).toBe(42);
    expect(setup.teams[0][0]!.uid).toBe('a0');
    expect(setup.teams[1][0]!.uid).toBe('b0');
    expect(setup.teams[0][0]!.stats).toEqual(deriveStats(pet, cfg));
    expect(setup.teams[0][0]!.skills).toEqual([
      'normal_strike',
      'water_wave',
      'water_torrent',
      'fish_tide',
    ]);
    expect(setup.teams[0][0]!.passiveId).toBe('passive_fish_flow');
    expect(setup.teams[1][0]!.passiveId).toBe('passive_turtle_shell');
  });

  it('每队最多 3 只', () => {
    const pets = [1, 2, 3, 4].map((i) => makePet({ id: `p${i}` }));
    const setup = buildBattleSetup([pets, pets], cfg, 1);
    expect(setup.teams[0]).toHaveLength(3);
    expect(setup.teams[1]).toHaveLength(3);
    expect(setup.teams[0].map((unit) => unit.uid)).toEqual(['a0', 'a1', 'a2']);
  });

  it('同一输入得到同一输出', () => {
    const pet = makePet();
    const first = buildBattleSetup([[pet], [pet]], cfg, 9);
    const second = buildBattleSetup([[pet], [pet]], cfg, 9);
    expect(second).toEqual(first);
  });
});

describe('buildEnemyTeam（DOMAIN §9.4）', () => {
  it('stage_1 生成 b0/b1，技能顺序固定、敌方满状态', () => {
    const team = buildEnemyTeam(cfg.stage('stage_1'), cfg, 7);
    expect(team.map((unit) => unit.uid)).toEqual(['b0', 'b1']);
    expect(team[0]!.speciesId).toBe('frog');
    expect(team[0]!.skills).toEqual([
      'normal_strike',
      'water_wave',
      'water_torrent',
      'frog_croak',
    ]);
    expect(team[0]!.petId).toBe('enemy_stage_1_0');
    // 满状态 → condMul = 1.1；草蛙基础 dodoge 0.04 × 1.1 × 被动 1.05
    expect(team[0]!.stats.dodge).toBeCloseTo(0.0462, 4);
  });

  it('同一 stage/seed 完全一致', () => {
    const stage = cfg.stage('stage_2');
    expect(buildEnemyTeam(stage, cfg, 3)).toEqual(buildEnemyTeam(stage, cfg, 3));
  });

  it('等级/基因质量影响快照属性', () => {
    const low = cfg.stage('stage_1');
    const high = {
      ...low,
      enemies: low.enemies.map((enemy) => ({ ...enemy, level: enemy.level + 10 })),
    };
    const lowTeam = buildEnemyTeam(low, cfg, 1);
    const highTeam = buildEnemyTeam(high, cfg, 1);
    expect(highTeam[0]!.stats.hp).toBeGreaterThan(lowTeam[0]!.stats.hp);
  });

  it('所有样例关卡都能生成', () => {
    for (const stage of cfg.allStages()) {
      const team = buildEnemyTeam(stage, cfg, 1);
      expect(team.length).toBe(stage.enemies.length);
      for (const unit of team) expect(unit.stats.hp).toBeGreaterThan(0);
    }
  });
});

describe('BattleEngine：初始状态与精力（DOMAIN §9.3）', () => {
  it('初始精力 0，第 1 回合开始 +20；hp = maxHp；battleStart 无循环日志', () => {
    const engine = BattleEngine.create(setupOf(makeUnit('a0'), makeUnit('b0')), cfg);
    const state = engine.state;

    expect(state.turn).toBe(1);
    expect(state.phase).toBe('ongoing');
    expect(state.units[0]!.energy).toBe(20);
    expect(state.units[0]!.hp).toBe(state.units[0]!.maxHp);
    expect(state.log[0]!.type).toBe('battleStart');
    const start = state.log[0]!;
    if (start.type !== 'battleStart') throw new Error('bad event');
    expect(start.state.log).toEqual([]);
  });

  it('普攻命中 +10：一回合后 20 → 30，下一回合开始 +20', () => {
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', {
          stats: { spd: 20 },
          skills: ['normal_strike', 'water_wave', 'water_torrent', 'fish_tide'],
        }),
        makeUnit('b0'),
      ),
      cfg,
    );

    const commands = engine.availableCommands('a0');
    expect(commands.map((cmd) => (cmd.type === 'skill' ? cmd.skillId : cmd.type))).toEqual([
      'normal_strike',
      'surrender',
    ]);

    const events = engine.submit(normal(engine, 'a0', 'b0'));
    expect(events[0]!.type).toBe('cast');
    expect(events.some((event) => event.type === 'hit')).toBe(true);
    expect(engine.state.units[0]!.energy).toBe(30);

    engine.submit(normal(engine, 'b0', 'a0'));
    expect(engine.state.turn).toBe(2);
    expect(engine.state.units[0]!.energy).toBe(50);
    expect(engine.state.units[1]!.energy).toBe(50);

    // 精力 50 时小技能（45）可用。
    expect(
      engine.availableCommands('a0').some((cmd) => cmd.type === 'skill' && cmd.skillId === 'water_wave'),
    ).toBe(true);
  });

  it('精力不足 / 未轮到 / 回合不符都拒绝', () => {
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, skills: ['normal_strike', 'water_wave'] }),
        makeUnit('b0'),
      ),
      cfg,
    );
    expect(() =>
      engine.submit({ type: 'skill', turn: 1, uid: 'a0', skillId: 'water_wave', targetUids: ['b0'] }),
    ).toThrow(/精力不足/);

    expect(() =>
      engine.submit({ type: 'skill', turn: 2, uid: 'a0', skillId: 'normal_strike', targetUids: ['b0'] }),
    ).toThrow(/回合/);

    expect(() =>
      engine.submit({ type: 'skill', turn: 1, uid: 'b0', skillId: 'normal_strike', targetUids: ['a0'] }),
    ).toThrow(/还没轮到/);
  });

  it('不是自己的回合时 availableCommands 为空', () => {
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { stats: { spd: 20 } }), makeUnit('b0')),
      cfg,
    );
    expect(engine.availableCommands('b0')).toEqual([]);
    expect(engine.availableCommands('a0').length).toBeGreaterThan(0);
  });

  it('投降：对方获胜，战斗结束', () => {
    const engine = BattleEngine.create(setupOf(makeUnit('a0'), makeUnit('b0')), cfg);
    const events = engine.submit({ type: 'surrender', turn: 1, uid: 'a0' });
    const end = events.at(-1)!;
    expect(end.type).toBe('battleEnd');
    if (end.type === 'battleEnd') {
      expect(end.winner).toBe(1);
      expect(end.turns).toBe(1);
    }
    expect(engine.state.phase).toBe('finished');
    expect(engine.availableCommands('a0')).toEqual([]);
    expect(engine.submit(normal(engine, 'a0', 'b0'))).toEqual([]);
  });

  it('击倒全部敌人即结束', () => {
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { stats: { spd: 20 } }), makeUnit('b0', { stats: { hp: 1 } })),
      cfg,
    );
    const events = engine.submit(normal(engine, 'a0', 'b0'));
    expect(events.some((event) => event.type === 'death')).toBe(true);
    const end = events.at(-1)!;
    expect(end.type).toBe('battleEnd');
    if (end.type === 'battleEnd') expect(end.winner).toBe(0);
  });

  it('30 回合仍未分胜负 → 平局（winner = null）', () => {
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { stats: { hp: 1_000_000 } }), makeUnit('b0', { stats: { hp: 1_000_000 } })),
      cfg,
    );
    let steps = 0;
    while (engine.state.phase === 'ongoing' && steps < 200) {
      const actor = engine.state.order[engine.state.cursor]!;
      const target = actor === 'a0' ? 'b0' : 'a0';
      engine.submit(normal(engine, actor, target));
      steps += 1;
    }
    expect(engine.state.phase).toBe('finished');
    expect(engine.state.winner).toBeNull();
    expect(engine.state.log.at(-1)!.type).toBe('battleEnd');
    const last = engine.state.log.at(-1)!;
    if (last.type === 'battleEnd') expect(last.turns).toBe(MAX_TURNS);
    expect(steps).toBe(MAX_TURNS * 2);
  });
});

describe('BattleEngine：伤害公式（DOMAIN §4.3）', () => {
  it('K=400，浮动 0.95~1.05', () => {
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { stats: { spd: 20 } }), makeUnit('b0', { stats: { hp: 10_000 } })),
      cfg,
    );
    const hit = hitOf(engine.submit(normal(engine, 'a0', 'b0')));
    // 400 × 1 × 400/(400+0) = 400
    expect(hit.damage).toBeGreaterThanOrEqual(380);
    expect(hit.damage).toBeLessThanOrEqual(420);
    expect(hit.countered).toBe(1);
    expect(hit.crit).toBe(false);
  });

  it('防御 400 时基础伤害减半', () => {
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 } }),
        makeUnit('b0', { stats: { hp: 10_000, def: 400 } }),
      ),
      cfg,
    );
    const hit = hitOf(engine.submit(normal(engine, 'a0', 'b0')));
    expect(hit.damage).toBeGreaterThanOrEqual(190);
    expect(hit.damage).toBeLessThanOrEqual(210);
  });

  it('暴击 ×150%', () => {
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20, crit: 1 } }),
        makeUnit('b0', { stats: { hp: 10_000 } }),
      ),
      cfg,
    );
    const hit = hitOf(engine.submit(normal(engine, 'a0', 'b0')));
    expect(hit.crit).toBe(true);
    expect(hit.damage).toBeGreaterThanOrEqual(570);
    expect(hit.damage).toBeLessThanOrEqual(630);
  });

  it('克制 1.25 / 被克制 0.85', () => {
    const strong = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, speciesId: 'turtle' }),
        makeUnit('b0', { stats: { hp: 10_000 }, speciesId: 'fish' }),
      ),
      cfg,
    );
    const strongHit = hitOf(strong.submit(normal(strong, 'a0', 'b0')));
    expect(strongHit.countered).toBe(1.25);
    expect(strongHit.damage).toBeGreaterThanOrEqual(475);
    expect(strongHit.damage).toBeLessThanOrEqual(525);

    const weak = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, speciesId: 'fish' }),
        makeUnit('b0', { stats: { hp: 10_000 }, speciesId: 'turtle' }),
      ),
      cfg,
    );
    const weakHit = hitOf(weak.submit(normal(weak, 'a0', 'b0')));
    expect(weakHit.countered).toBe(0.85);
    expect(weakHit.damage).toBeGreaterThanOrEqual(323);
    expect(weakHit.damage).toBeLessThanOrEqual(357);
  });

  it('命中率 clamp 下限 0.05：低命中会 miss 且不扣血', () => {
    let found = false;
    for (let seed = 0; seed < 300 && !found; seed += 1) {
      const engine = BattleEngine.create(
        setupOf(
          makeUnit('a0', { stats: { spd: 20, hit: -0.5 } }),
          makeUnit('b0', { stats: { hp: 1000, dodge: 5 } }),
          seed,
        ),
        cfg,
      );
      const events = engine.submit(normal(engine, 'a0', 'b0'));
      const miss = events.find((event) => event.type === 'miss');
      if (miss) {
        found = true;
        expect(engine.state.units[1]!.hp).toBe(1000);
      }
    }
    expect(found).toBe(true);
  });
});

describe('BattleEngine：状态与效果', () => {
  it('眩晕：轮到时跳过并消耗', () => {
    const stunCfg = makeRepo((config) => {
      (skillRow(config, 'grass_vine')['effects'] as Array<Record<string, unknown>>)[0]!['chance'] = 1;
    });
    const skills = ['normal_strike', 'grass_vine'];
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, skills }),
        makeUnit('b0', { stats: { hp: 10_000 }, skills }),
      ),
      stunCfg,
    );

    engine.submit(normal(engine, 'a0', 'b0'));
    engine.submit(normal(engine, 'b0', 'a0'));
    expect(engine.state.turn).toBe(2);

    const events = engine.submit({
      type: 'skill',
      turn: 2,
      uid: 'a0',
      skillId: 'grass_vine',
      targetUids: ['b0'],
    });
    expect(events.some((event) => event.type === 'buffApply')).toBe(true);
    expect(events.some((event) => event.type === 'buffExpire')).toBe(true);
    // 眩晕吃掉 b0 本回合行动：直接进入第 3 回合。
    expect(engine.state.turn).toBe(3);
  });

  it('DOT 在回合开始结算', () => {
    const dotCfg = makeRepo((config) => {
      const effects = skillRow(config, 'fire_ember')['effects'] as Array<Record<string, unknown>>;
      effects[0]!['chance'] = 1;
    });
    const skills = ['normal_strike', 'fire_ember'];
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, skills, elementId: 'fire' }),
        makeUnit('b0', { stats: { hp: 10_000 }, skills }),
      ),
      dotCfg,
    );

    engine.submit(normal(engine, 'a0', 'b0'));
    engine.submit(normal(engine, 'b0', 'a0'));
    engine.submit({ type: 'skill', turn: 2, uid: 'a0', skillId: 'fire_ember', targetUids: ['b0'] });
    const turn2Events = engine.submit(normal(engine, 'b0', 'a0'));
    const ticks = turn2Events.filter((event) => event.type === 'dotTick');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    if (ticks[0] && ticks[0].type === 'dotTick') expect(ticks[0].damage).toBe(4);
  });

  it('治疗不超过上限，并发出 heal 事件', () => {
    const healCfg = makeRepo((config) => {
      addSkill(config, {
        id: 'test_heal',
        name: '测试治疗',
        kind: 'active',
        cost: 0,
        target: 'allyAll',
        power: 0,
        effects: [{ kind: 'heal', value: 20, duration: 0, chance: 1 }],
      });
    });
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20, atk: 100 } }),
        makeUnit('b0', { stats: { hp: 200 }, skills: ['normal_strike', 'test_heal'] }),
      ),
      healCfg,
    );

    engine.submit(normal(engine, 'a0', 'b0'));
    const hpBefore = engine.state.units[1]!.hp;
    const events = engine.submit({
      type: 'skill',
      turn: 1,
      uid: 'b0',
      skillId: 'test_heal',
      targetUids: ['b0'],
    });
    const heal = events.find((event) => event.type === 'heal');
    expect(heal).toBeDefined();
    expect(engine.state.units[1]!.hp).toBeGreaterThan(hpBefore);
    expect(engine.state.units[1]!.hp).toBeLessThanOrEqual(200);
  });

  it('净化移除减益', () => {
    const cleanseCfg = makeRepo((config) => {
      addSkill(config, {
        id: 'test_debuff',
        name: '测试减益',
        kind: 'active',
        cost: 0,
        target: 'single',
        power: 0,
        effects: [{ kind: 'debuff', value: 0.2, duration: 3, chance: 1, stat: 'atk' }],
      });
      addSkill(config, {
        id: 'test_cleanse',
        name: '测试净化',
        kind: 'active',
        cost: 0,
        target: 'self',
        power: 0,
        effects: [{ kind: 'cleanse', value: 0, duration: 0, chance: 1, target: 'self' }],
      });
    });
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, skills: ['normal_strike', 'test_debuff'] }),
        makeUnit('b0', { skills: ['normal_strike', 'test_cleanse'] }),
      ),
      cleanseCfg,
    );

    engine.submit({ type: 'skill', turn: 1, uid: 'a0', skillId: 'test_debuff', targetUids: ['b0'] });
    expect(engine.state.units[1]!.buffs).toHaveLength(1);
    const events = engine.submit({
      type: 'skill',
      turn: 1,
      uid: 'b0',
      skillId: 'test_cleanse',
      targetUids: ['b0'],
    });
    expect(events.some((event) => event.type === 'buffExpire')).toBe(true);
    expect(engine.state.units[1]!.buffs).toHaveLength(0);
  });

  it('护盾吸收伤害', () => {
    const shieldCfg = makeRepo((config) => {
      addSkill(config, {
        id: 'test_shield',
        name: '测试护盾',
        kind: 'active',
        cost: 0,
        target: 'self',
        power: 0,
        effects: [{ kind: 'shield', value: 50, duration: 2, chance: 1 }],
      });
    });
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 } }),
        makeUnit('b0', { stats: { hp: 10_000 }, skills: ['normal_strike', 'test_shield'] }),
      ),
      shieldCfg,
    );

    engine.submit(normal(engine, 'a0', 'b0'));
    engine.submit({ type: 'skill', turn: 1, uid: 'b0', skillId: 'test_shield', targetUids: ['b0'] });
    const hpFull = engine.state.units[1]!.hp;

    const hit = hitOf(engine.submit(normal(engine, 'a0', 'b0')));
    expect(hpFull - engine.state.units[1]!.hp).toBe(Math.max(0, hit.damage - 50));
  });

  it('沉默期间不能使用主动技能', () => {
    const silenceCfg = makeRepo((config) => {
      addSkill(config, {
        id: 'test_silence',
        name: '测试沉默',
        kind: 'active',
        cost: 0,
        target: 'single',
        power: 0,
        effects: [{ kind: 'silence', value: 0, duration: 2, chance: 1 }],
      });
    });
    const engine = BattleEngine.create(
      setupOf(
        makeUnit('a0', { stats: { spd: 20 }, skills: ['normal_strike', 'test_silence'] }),
        makeUnit('b0', { skills: ['normal_strike', 'water_wave'] }),
      ),
      silenceCfg,
    );

    engine.submit({
      type: 'skill',
      turn: 1,
      uid: 'a0',
      skillId: 'test_silence',
      targetUids: ['b0'],
    });
    engine.submit(normal(engine, 'b0', 'a0'));
    expect(engine.state.turn).toBe(2);
    // 第 2 回合 b0 精力 50（够 45），但仍被沉默。
    engine.submit(normal(engine, 'a0', 'b0'));
    const commands = engine.availableCommands('b0');
    expect(commands.some((cmd) => cmd.type === 'skill' && cmd.skillId === 'water_wave')).toBe(false);
    expect(commands.some((cmd) => cmd.type === 'skill' && cmd.skillId === 'normal_strike')).toBe(true);
    expect(() =>
      engine.submit({ type: 'skill', turn: 2, uid: 'b0', skillId: 'water_wave', targetUids: ['a0'] }),
    ).toThrow(/沉默/);
  });

  it('被动开场效果在 battleStart 后结算', () => {
    const passiveCfg = makeRepo((config) => {
      addPassive(config, {
        id: 'test_passive',
        name: '测试被动',
        description: '开场攻击 +10%。',
        effects: [
          { kind: 'buff', value: 0.1, duration: 2, chance: 1, stat: 'atk', target: 'self' },
        ],
      });
    });
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { passiveId: 'test_passive' }), makeUnit('b0')),
      passiveCfg,
    );
    const state = engine.state;
    expect(state.log[0]!.type).toBe('battleStart');
    expect(state.log[1]!.type).toBe('buffApply');
    expect(state.units[0]!.buffs).toHaveLength(1);
  });

  it('buff 到期移除', () => {
    const passiveCfg = makeRepo((config) => {
      addPassive(config, {
        id: 'test_passive',
        name: '测试被动',
        description: '开场攻击 +10%。',
        effects: [
          { kind: 'buff', value: 0.1, duration: 1, chance: 1, stat: 'atk', target: 'self' },
        ],
      });
    });
    const engine = BattleEngine.create(
      setupOf(makeUnit('a0', { passiveId: 'test_passive' }), makeUnit('b0')),
      passiveCfg,
    );
    engine.submit(normal(engine, 'a0', 'b0'));
    const events = engine.submit(normal(engine, 'b0', 'a0'));
    expect(events.some((event) => event.type === 'buffExpire')).toBe(true);
    expect(engine.state.units[0]!.buffs).toHaveLength(0);
  });

  it('群体技能对每个目标独立结算', () => {
    const allCfg = makeRepo((config) => {
      addSkill(config, {
        id: 'test_all',
        name: '测试群攻',
        kind: 'active',
        cost: 0,
        target: 'all',
        power: 1,
        effects: [],
      });
    });
    const engine = BattleEngine.create(
      {
        seed: 5,
        teams: [
          [makeUnit('a0', { stats: { spd: 20 }, skills: ['normal_strike', 'test_all'] })],
          [makeUnit('b0', { stats: { hp: 10_000 } }), makeUnit('b1', { stats: { hp: 10_000 } })],
        ],
      },
      allCfg,
    );
    const events = engine.submit({
      type: 'skill',
      turn: 1,
      uid: 'a0',
      skillId: 'test_all',
      targetUids: [],
    });
    const hits = events.filter((event) => event.type === 'hit');
    expect(hits).toHaveLength(2);
    const cast = events[0]!;
    if (cast.type === 'cast') expect(cast.targets).toEqual(['b0', 'b1']);
  });
});
