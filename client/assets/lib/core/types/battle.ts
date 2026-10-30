// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 战斗输入、指令与事件（DOMAIN_MODEL §9，TECH_DESIGN §12）。
 *
 * 关键规则（已冻结，实现见 A 会话）：
 * - 初始精力 0；每回合开始 +20；普攻命中 +10；小技能 40~50；大招 70~80。
 * - 伤害 ATK × power × K/(K+DEF)，K=400；暴击 150%；克制 1.25/0.85；浮动 0.95~1.05。
 * - 状态差通过 deriveStats 降低属性，进入战斗后不再额外乘算。
 * - 同速排序必须中立（种子序或队伍交替），禁止固定 0 队先手。
 * - 30 回合上限，未分胜负 winner = null（平局）。
 */
import type { CounterMultiplier, ElementId, Id } from './common';
import type { StatBlock } from './stats';

export type BattleTeamIndex = 0 | 1;
export type BattleWinner = 0 | 1 | null;

export interface BattleUnitInit {
  /** "a0" / "b0" 形式，战斗内唯一。 */
  uid: string;
  petId: Id;
  speciesId: Id;
  elementId: ElementId;
  level: number;
  /** deriveStats 结果，已含等级/基因/状态/特质/相性/被动 statMods。 */
  stats: StatBlock;
  /** [普攻, 属性小技能, 属性大招, 物种技能]。 */
  skills: Id[];
  traits: Id[];
  /** 物种被动；statMods 已计入 stats，effects 在 battleStart 一次性应用。 */
  passiveId?: Id;
}

export interface BattleSetup {
  seed: number;
  teams: [BattleUnitInit[], BattleUnitInit[]];
}

export type BuffKind = 'buff' | 'debuff' | 'shield' | 'stun' | 'silence' | 'slow' | 'dot';

export interface BattleBuff {
  id: string;
  kind: BuffKind;
  stat?: 'atk' | 'def' | 'spd';
  value: number;
  remainingTurns: number;
  sourceUid: string;
}

export interface BattleUnit {
  uid: string;
  team: BattleTeamIndex;
  slot: number;
  petId: Id;
  speciesId: Id;
  elementId: ElementId;
  level: number;
  stats: StatBlock;
  skills: Id[];
  traits: Id[];
  passiveId?: Id;
  hp: number;
  maxHp: number;
  /** 0~100；初始 0。 */
  energy: number;
  alive: boolean;
  buffs: BattleBuff[];
}

/** 指令。客户端只能提交动作，不能提交结果。 */
export type Command =
  | { type: 'skill'; turn: number; uid: string; skillId: Id; targetUids: string[] }
  | { type: 'surrender'; turn: number; uid: string };

export interface BattleEventBase {
  /** 战斗内严格递增。 */
  seq: number;
  turn: number;
}

export type BattleEvent =
  | (BattleEventBase & { type: 'battleStart'; state: BattleState })
  | (BattleEventBase & { type: 'turnStart'; order: string[] })
  | (BattleEventBase & { type: 'cast'; uid: string; skillId: Id; targets: string[] })
  | (BattleEventBase & {
      type: 'hit';
      src: string;
      dst: string;
      damage: number;
      crit: boolean;
      countered: CounterMultiplier;
    })
  | (BattleEventBase & { type: 'miss'; src: string; dst: string })
  | (BattleEventBase & { type: 'heal'; src: string; dst: string; amount: number })
  | (BattleEventBase & { type: 'shield'; src: string; dst: string; amount: number })
  | (BattleEventBase & {
      type: 'buffApply';
      src: string;
      dst: string;
      buffId: string;
      kind: BuffKind;
      stat?: 'atk' | 'def' | 'spd';
      value: number;
      remainingTurns: number;
    })
  | (BattleEventBase & { type: 'buffExpire'; dst: string; buffId: string })
  | (BattleEventBase & { type: 'dotTick'; src: string; dst: string; damage: number })
  | (BattleEventBase & { type: 'energyTick'; uid: string; energy: number })
  | (BattleEventBase & { type: 'death'; uid: string })
  | (BattleEventBase & { type: 'battleEnd'; winner: BattleWinner; turns: number });

export interface BattleState {
  seed: number;
  /** 1 起；> 30 平局。 */
  turn: number;
  units: BattleUnit[];
  order: string[];
  cursor: number;
  phase: 'ongoing' | 'finished';
  winner: BattleWinner;
  log: BattleEvent[];
}
