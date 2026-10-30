import { describe, expect, it } from 'vitest';

import {
  BattleReplayError,
  buildPveBattleSetup,
  runBattle,
  type BattleSetup,
  type BattleUnitInit,
  type Command,
  type StatBlock,
} from '@petbattle/core';

import {
  autoCommandImpl,
  createBattleContextImpl,
  submitCommandImpl,
} from '../src/battle/engine.js';
import { makePet } from './factory.js';
import { SYNTHETIC_NORMAL, SYNTHETIC_STAGE_ID, makeSyntheticRepo } from './synthetic.js';

const cfg = makeSyntheticRepo();
const stage = cfg.stage(SYNTHETIC_STAGE_ID);

function makeUnit(uid: string, stats: Partial<StatBlock> = {}): BattleUnitInit {
  return {
    uid,
    petId: `pet_${uid}`,
    speciesId: 'fish',
    elementId: 'water',
    level: 1,
    stats: {
      hp: 10_000,
      atk: 400,
      def: 0,
      spd: 10,
      crit: 0,
      critDmg: 1.5,
      hit: 0.5,
      dodge: 0,
      ...stats,
    },
    skills: [SYNTHETIC_NORMAL],
    traits: [],
  };
}

/** 用内置 AI 生成一条完整指令序列（重放测试用）。 */
function aiCommands(setup: BattleSetup): Command[] {
  const ctx = createBattleContextImpl(setup, cfg);
  const commands: Command[] = [];
  let guard = 0;
  while (ctx.state.phase === 'ongoing' && guard < 500) {
    const command = autoCommandImpl(ctx, ctx.state.order[ctx.state.cursor]!);
    commands.push(command);
    submitCommandImpl(ctx, command);
    guard += 1;
  }
  return commands;
}

describe('runBattle（E-02/E-08）', () => {
  it('完整指令序列重放：与引擎直接驱动的事件流逐条一致', () => {
    const setup = buildPveBattleSetup(
      [makePet({ id: 'p1', speciesId: 'fish', level: 3 })],
      stage,
      cfg,
      2024,
    );
    const commands = aiCommands(setup);

    const first = runBattle(setup, cfg, commands);
    const second = runBattle(setup, cfg, commands);

    expect(first.winner).toBe(second.winner);
    expect(first.turns).toBe(second.turns);
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(first.events[0]!.type).toBe('battleStart');
    expect(first.events.at(-1)!.type).toBe('battleEnd');
    expect(first.turns).toBeGreaterThan(0);
  });

  it('指令用尽仍未结束 → not_finished', () => {
    const setup: BattleSetup = { seed: 1, teams: [[makeUnit('a0')], [makeUnit('b0')]] };
    expect(() => runBattle(setup, cfg, [])).toThrow(BattleReplayError);
    try {
      runBattle(setup, cfg, []);
    } catch (error) {
      expect((error as BattleReplayError).reason).toBe('not_finished');
    }
  });

  it('回合不符 / 不是当前行动者 → invalid_command', () => {
    const setup: BattleSetup = {
      seed: 1,
      teams: [[makeUnit('a0', { spd: 20 })], [makeUnit('b0')]],
    };
    try {
      runBattle(setup, cfg, [
        { type: 'skill', turn: 2, uid: 'a0', skillId: SYNTHETIC_NORMAL, targetUids: ['b0'] },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(BattleReplayError);
      expect((error as BattleReplayError).reason).toBe('invalid_command');
    }

    expect(() =>
      runBattle(setup, cfg, [
        { type: 'skill', turn: 1, uid: 'b0', skillId: SYNTHETIC_NORMAL, targetUids: ['a0'] },
      ]),
    ).toThrow(/invalid_command/);
  });

  it('战斗结束后多余的指令被忽略', () => {
    const setup: BattleSetup = {
      seed: 1,
      teams: [[makeUnit('a0', { spd: 20 })], [makeUnit('b0', { hp: 1 })]],
    };
    const commands: Command[] = [
      { type: 'skill', turn: 1, uid: 'a0', skillId: SYNTHETIC_NORMAL, targetUids: ['b0'] },
      { type: 'skill', turn: 99, uid: 'ghost', skillId: SYNTHETIC_NORMAL, targetUids: [] },
    ];
    const result = runBattle(setup, cfg, commands);
    expect(result.winner).toBe(0);
    expect(result.turns).toBe(1);
  });

  it('30 回合上限：平局返回 winner=null, turns=30', () => {
    const setup: BattleSetup = {
      seed: 5,
      teams: [
        [makeUnit('a0', { hp: 1_000_000, atk: 1 })],
        [makeUnit('b0', { hp: 1_000_000, atk: 1 })],
      ],
    };
    const commands = aiCommands(setup);
    const result = runBattle(setup, cfg, commands);
    expect(result.winner).toBeNull();
    expect(result.turns).toBe(30);
  });

  it('非法的目标同样算 invalid_command', () => {
    const setup: BattleSetup = {
      seed: 1,
      teams: [[makeUnit('a0', { spd: 20 })], [makeUnit('b0')]],
    };
    expect(() =>
      runBattle(setup, cfg, [
        { type: 'skill', turn: 1, uid: 'a0', skillId: SYNTHETIC_NORMAL, targetUids: ['ghost'] },
      ]),
    ).toThrow(BattleReplayError);
  });
});
