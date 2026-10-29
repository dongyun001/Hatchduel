import { describe, expect, it } from 'vitest';

import {
  buildBattleSetup,
  buildEnemyTeam,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
} from '@petbattle/core';

import {
  chooseAiCommandImpl,
  createBattleContextImpl,
  submitCommandImpl,
} from '../src/battle/engine.js';
import { makePet, makeRepo } from './factory.js';

const cfg = makeRepo();

function playerTeam() {
  return buildBattleSetup(
    [
      [
        makePet({ id: 'p1', speciesId: 'fish', elementId: 'water', level: 3 }),
        makePet({ id: 'p2', speciesId: 'turtle', elementId: 'earth', level: 3 }),
      ],
      [],
    ],
    cfg,
    99,
  ).teams[0];
}

function pveSetup(seed: number): BattleSetup {
  return {
    seed,
    teams: [playerTeam(), buildEnemyTeam(cfg.stage('stage_1'), cfg, seed)],
  };
}

function playToEnd(setup: BattleSetup): BattleState {
  const ctx = createBattleContextImpl(setup, cfg);
  let guard = 0;
  while (ctx.state.phase === 'ongoing' && guard < 500) {
    const cmd = chooseAiCommandImpl(ctx);
    if (!cmd) break;
    submitCommandImpl(ctx, cmd);
    guard += 1;
  }
  return ctx.state;
}

/** 事件流压缩成可读投影，用于确定性快照。 */
function project(events: readonly BattleEvent[]): string[] {
  return events.map((event) => {
    switch (event.type) {
      case 'hit':
        return `hit:${event.src}>${event.dst}:${event.damage}:${event.crit ? 'crit' : 'norm'}:${event.countered}`;
      case 'cast':
        return `cast:${event.uid}:${event.skillId}:${event.targets.join(',')}`;
      case 'miss':
        return `miss:${event.src}>${event.dst}`;
      case 'turnStart':
        return `turnStart:${event.turn}:${event.order.join(',')}`;
      case 'energyTick':
        return `energy:${event.uid}:${event.energy}`;
      case 'battleStart':
        return 'battleStart';
      case 'battleEnd':
        return `battleEnd:${event.winner ?? 'draw'}:${event.turns}`;
      default:
        return `${event.type}:${event.turn}`;
    }
  });
}

/** 事件流指纹（FNV-1a 32 位），用于紧凑的固定种子快照。 */
function digest(lines: readonly string[]): string {
  const text = lines.join('\n');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe('确定性：同一 (setup, seed, commands) 双跑逐事件一致', () => {
  it('PVE 全 AI 对局两次完全一致', () => {
    const first = playToEnd(pveSetup(2024));
    const second = playToEnd(pveSetup(2024));
    expect(JSON.stringify(second.log)).toBe(JSON.stringify(first.log));
    expect(second.winner).toBe(first.winner);
    expect(second.turn).toBe(first.turn);
  });

  it('不同种子产生不同事件流', () => {
    const a = playToEnd(pveSetup(1));
    const b = playToEnd(pveSetup(2));
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(b.log));
  });

  it('AI 决策本身确定', () => {
    const ctxA = createBattleContextImpl(pveSetup(77), cfg);
    const ctxB = createBattleContextImpl(pveSetup(77), cfg);
    expect(chooseAiCommandImpl(ctxB)).toEqual(chooseAiCommandImpl(ctxA));
  });

  it('battleStart 快照不包含日志（无循环引用，可 JSON 序列化）', () => {
    const state = playToEnd(pveSetup(3));
    const json = JSON.stringify(state);
    expect(json.length).toBeGreaterThan(0);
    const start = state.log[0]!;
    expect(start.type).toBe('battleStart');
    if (start.type === 'battleStart') expect(start.state.log).toEqual([]);
  });

  it('固定种子快照（PVE stage_1，seed 99）', () => {
    const state = playToEnd(pveSetup(99));
    // 逐事件投影的指纹：锁定确定性；改核心逻辑必须同步更新。
    const fingerprint = digest(project(state.log));
    expect(fingerprint).toMatchInlineSnapshot(`"599747b4"`);
    expect(state.phase).toBe('finished');
    expect(state.log.length).toBeGreaterThan(20);
    expect(state.log.at(-1)!.type).toBe('battleEnd');
  });
});

describe('同速排序中立（P-004）', () => {
  function unit(uid: string) {
    return {
      uid,
      petId: uid,
      speciesId: 'fish',
      elementId: 'water' as const,
      level: 1,
      stats: { hp: 100_000, atk: 1, def: 0, spd: 10, crit: 0, critDmg: 1.5, hit: 0, dodge: 0 },
      skills: ['normal_strike'],
      traits: [],
    };
  }

  function firstActor(seed: number): string {
    const ctx = createBattleContextImpl({ seed, teams: [[unit('a0')], [unit('b0')]] }, cfg);
    return ctx.state.order[0]!;
  }

  it('1000 个种子下，同速双方先手接近 50/50', () => {
    let aFirst = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      if (firstActor(seed) === 'a0') aFirst += 1;
    }
    expect(aFirst).toBeGreaterThan(400);
    expect(aFirst).toBeLessThan(600);
  });

  it('交换队伍顺序后先手仍中立（不偏向固定 0 队）', () => {
    let swappedAFirst = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      const ctx = createBattleContextImpl(
        { seed, teams: [[unit('b0')], [unit('a0')]] },
        cfg,
      );
      if (ctx.state.order[0] === 'b0') swappedAFirst += 1;
    }
    expect(swappedAFirst).toBeGreaterThan(400);
    expect(swappedAFirst).toBeLessThan(600);
  });
});
