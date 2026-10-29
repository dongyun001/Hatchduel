// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 宠物个体（DOMAIN_MODEL §3）。 */
import type { EpochMs, ElementId, Id } from './common';
import type { CoreStatKey } from './stats';

export type PetId = Id;
export type HabitatId = Id;

/** 年龄阶段：蛋 / 幼年 / 成年 / 老年；宠物不死亡。 */
export type Stage = 'egg' | 'juvenile' | 'adult' | 'elder';

export type Gender = 'male' | 'female';

export interface TraitAllele {
  traitId: Id;
  dominant: boolean;
}

export interface Genome {
  /** 四项数值基因，0~100 整数。 */
  stats: Record<CoreStatKey, number>;
  /** 父母物种，供未来杂交使用。 */
  speciesAlleles: [Id, Id];
  /** 父母属性。 */
  elementAlleles: [ElementId, ElementId];
  traitAlleles: TraitAllele[];
  /** 只统计属性 / 特质突变，基因波动不算。 */
  mutationCount: number;
}

export interface Condition {
  /** 0~100，允许小数。 */
  hunger: number;
  mood: number;
  hygiene: number;
  /** 0~100，地板 1；不死亡。 */
  health: number;
}

/** 血统引用：depth 1=父母，2=祖父母，3=曾祖父母。 */
export interface AncestorRef {
  id: PetId;
  depth: number;
}

export interface FertilityState {
  readyAt: EpochMs;
  cooldownUntil: EpochMs;
  /** 0~1，近亲惩罚。 */
  penalty: number;
}

export interface PetInstance {
  id: PetId;
  /** 玩家可改名；缺省用物种名。 */
  name?: string;
  speciesId: Id;
  elementId: ElementId;
  genome: Genome;
  /** 已表达特质。 */
  traits: Id[];
  /** 隐性特质。 */
  hiddenTraits: Id[];
  gender: Gender;
  /** 1 起。 */
  generation: number;
  parents: [PetId | null, PetId | null];
  /** 最多 3 代、去重。 */
  ancestors: AncestorRef[];
  bornAt: EpochMs;
  stage: Stage;
  stageChangedAt: EpochMs;
  /** 1~20（MVP）。 */
  level: number;
  exp: number;
  condition: Condition;
  fertility: FertilityState;
  habitatId: HabitatId | null;
  /** 锁定后不可放生 / 交易。 */
  locked: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}
