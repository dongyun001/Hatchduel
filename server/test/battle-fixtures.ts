/**
 * PvE 测试夹具：构造可控的 `BattleSetup` 与指令序列。
 *
 * 手写 `BattleUnitInit`（直接给 stats）比“造宠物再推进成年”更稳定：
 * 服务端 claim 只认会话里的 setup 快照，所以测试可以精确控制胜负/平局。
 */
import { BattleEngine } from '@petbattle/core';
import type { BattleSetup, BattleUnitInit, Command, ConfigRepo, StatBlock } from '@petbattle/core';

/** 配置里一定存在的普攻技能。 */
export const NORMAL_SKILL_ID = 'normal_strike';

export function unit(uid: string, stats: Partial<StatBlock> = {}): BattleUnitInit {
  return {
    uid,
    petId: `pet_${uid}`,
    speciesId: 'turtle',
    elementId: 'water',
    level: 1,
    stats: {
      hp: 100,
      atk: 0,
      def: 0,
      spd: 0,
      crit: 0,
      critDmg: 1.5,
      hit: 0,
      dodge: 0,
      ...stats,
    },
    // 只带普攻：伤害完全由 atk 决定，测试可精确控制。
    skills: [NORMAL_SKILL_ID],
    traits: [],
  };
}

export function setupOf(
  teamA: BattleUnitInit[],
  teamB: BattleUnitInit[],
  seed = 7,
): BattleSetup {
  return { seed, teams: [teamA, teamB] };
}

/** 必胜：先手且一击致命。 */
export function winningSetup(seed = 7): BattleSetup {
  return setupOf([unit('a0', { hp: 1000, atk: 1000, spd: 100 })], [unit('b0', { hp: 1 })], seed);
}

/** 必败：对手先手且一击致命。 */
export function losingSetup(seed = 7): BattleSetup {
  return setupOf([unit('a0', { hp: 1 })], [unit('b0', { hp: 1000, atk: 1000, spd: 100 })], seed);
}

/** 必定平局：双方伤害恒为 0，30 回合后按平局结束。 */
export function drawingSetup(seed = 7): BattleSetup {
  return setupOf([unit('a0', { hp: 100000, atk: 0 })], [unit('b0', { hp: 100000, atk: 0 })], seed);
}

/** 按内置 AI 把一场战斗打完，返回完整有序指令序列（用于思考“客户端会怎么交”）。 */
export function playToCommands(battleSetup: BattleSetup, cfg: ConfigRepo): Command[] {
  const engine = BattleEngine.create(battleSetup, cfg);
  const commands: Command[] = [];

  for (let step = 0; step < 800 && engine.state.phase === 'ongoing'; step += 1) {
    const uid = engine.state.order[engine.state.cursor];
    if (uid === undefined) throw new Error('战斗没有当前行动者');
    const command = engine.autoCommand(uid);
    commands.push(command);
    engine.submit(command);
  }

  if (engine.state.phase !== 'finished') {
    throw new Error('战斗未在步数上限内结束');
  }
  return commands;
}
