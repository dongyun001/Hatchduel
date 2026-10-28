/** 战斗与派生属性（DOMAIN_MODEL §2.1、§4）。 */

/** 八项属性。`hit` 只表示命中率修正，不是“效果命中”（PITFALLS P-003）。 */
export type StatKey = 'hp' | 'atk' | 'def' | 'spd' | 'crit' | 'critDmg' | 'hit' | 'dodge';

/** 参与等级 / 阶段 / 基因 / 相性修正的四项核心属性。 */
export type CoreStatKey = 'hp' | 'atk' | 'def' | 'spd';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /** 暴击率，0~1。 */
  crit: number;
  /** 暴击伤害倍率，默认 1.5。 */
  critDmg: number;
  /** 命中率修正，-0.5~0.5。 */
  hit: number;
  /** 闪避，0~0.9。 */
  dodge: number;
}
