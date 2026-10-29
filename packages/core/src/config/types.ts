/**
 * 配置表类型（DOMAIN_MODEL §2，TECH_DESIGN §8）。
 *
 * 这些类型对应 `src/config/data/*.json`。JSON 里不允许函数，
 * 所以 `HabitatConfig.upgrade` 用等级表表达，而不是 DOMAIN 里的函数式写法
 * （见 docs/CONTRACT.md §7 澄清 C-01）。
 */
import type {
  Affinity,
  CounterMultiplier,
  ElementId,
  EpochMs,
  Id,
  Probability,
  ResourceId,
} from '../types/common.js';
import type { Gender, PetInstance } from '../types/pet.js';
import type { ResourceBag, ResourceCost, ResourceRate } from '../types/profile.js';
import type { CoreStatKey, Grade, StatBlock, StatKey } from '../types/stats.js';

export interface SpeciesConfig {
  id: Id;
  name: string;
  grade: Record<CoreStatKey, Grade>;
  /** 1 级基准属性。 */
  base: StatBlock;
  /** 每级增量系数。 */
  growth: Record<CoreStatKey, number>;
  signatureSkillId: Id;
  /** 指向 passives.json；MVP 只在建战时生效。 */
  passiveId?: Id;
  /** 单向克制：本物种克制的对方物种 id。 */
  counters: Id[];
  habitatTags: ElementId[];
  rarity: 'common' | 'rare' | 'epic';
  breedable: boolean;
  spriteId: string;
}

export interface ElementConfig {
  id: ElementId;
  name: string;
  /** [小技能, 大招]。 */
  skillPool: [Id, Id];
  color: string;
  habitatTag: ElementId;
}

/** 只存非 0 项；缺省 = 0（普通）。 */
export type AffinityTable = Record<ElementId, Partial<Record<Id, Affinity>>>;

export type SkillKind = 'normal' | 'active';
export type SkillTarget = 'single' | 'all' | 'self' | 'ally' | 'allyAll';

export type EffectKind =
  | 'damage'
  | 'heal'
  | 'shield'
  | 'buff'
  | 'debuff'
  | 'stun'
  | 'silence'
  | 'slow'
  | 'dot'
  | 'cleanse';

export type EffectStat = 'atk' | 'def' | 'spd';

/**
 * 效果作用目标。技能用 `SkillConfig.target`；被动开场效果需要显式目标，
 * 因此 `PassiveConfig.effects` 必须填写 `target`（见 docs/CONTRACT.md §7 C-03）。
 */
export type EffectTarget = 'self' | 'enemy' | 'ally' | 'allEnemies' | 'allAllies';

export interface EffectSpec {
  kind: EffectKind;
  value: number;
  duration: number;
  chance: Probability;
  stat?: EffectStat;
  target?: EffectTarget;
}

export interface SkillConfig {
  id: Id;
  name: string;
  kind: SkillKind;
  /** 普攻 0；小技能 40~50；大招 70~80；物种技能按设计。 */
  cost: number;
  target: SkillTarget;
  /** 伤害倍率；纯功能技能可为 0。 */
  power: number;
  /** 附加效果；纯伤害技能用空数组，伤害由 power 决定（C-05）。 */
  effects: EffectSpec[];
  cooldown?: number;
}

export interface TraitConfig {
  id: Id;
  name: string;
  rarity: 'common' | 'rare' | 'epic';
  description: string;
  /** 乘数，如 { atk: 1.05 }。 */
  statMods?: Partial<Record<StatKey, number>>;
  /** 产出乘数，默认 1。 */
  productionMod?: number;
  /** 供 AI / 技能判定。 */
  battleTags?: string[];
  inheritance: { weight: Probability };
}

/** 被动独立建表；MVP 只在建战时生效，不做每回合 hook。 */
export interface PassiveConfig {
  id: Id;
  name: string;
  description: string;
  /** 建战时计入派生属性的乘数，如 { def: 1.08 }。 */
  statMods?: Partial<Record<StatKey, number>>;
  /** 开场一次性效果；每条必须带 target。 */
  effects?: EffectSpec[];
}

export interface HabitatLevelConfig {
  /** 从 1 开始，连续。 */
  level: number;
  cost: ResourceCost[];
  capacity: number;
  /** 该等级产出乘数，1 起。 */
  productionMul: number;
}

export interface HabitatUpgradeConfig {
  maxLevel: number;
  levels: HabitatLevelConfig[];
}

export interface HabitatConfig {
  id: Id;
  name: string;
  capacity: number;
  /** 匹配时的产出加成，如 0.15。 */
  elementBonus: Partial<Record<ElementId, number>>;
  productionPerHour: ResourceRate[];
  upkeepPerPetPerHour: ResourceRate[];
  conditionDecayPerHour: { hunger: number; mood: number; hygiene: number };
  healthDecayWhenStarving: number;
  /** 饥饿/清洁均 ≥50 时每小时恢复；初版，待 sim。 */
  healthRecoveryPerHour: number;
  /** 食物（upkeep）不足时，每只宠物每小时额外扣的饥饿；缺省 0（contract-v1.2 D-05）。 */
  hungerPenaltyWhenNoFoodPerHour?: number;
  /**
   * 照料动作的恢复量（contract-v1.3 D-12）：`clean` 恢复 hygiene、`play` 恢复 mood。
   * 缺省 20 / 20；清洁与陪玩不消耗资源。
   */
  careRecoveryPerAction?: {
    clean?: number;
    play?: number;
  };
  /**
   * 产出阶段系数；缺省 0.5 / 1 / 0.8（DOMAIN §6.1，contract-v1.2 D-06）。
   * 只影响栖息地产出，不影响战斗属性。
   */
  productionStageMul?: {
    juvenile: number;
    adult: number;
    elder: number;
  };
  /** 默认 8h。 */
  offlineCapMs: EpochMs;
  /** 默认 24h。 */
  decayCapMs: EpochMs;
  upgrade: HabitatUpgradeConfig;
}

export interface FoodConfig {
  id: Id;
  name: string;
  cost: ResourceCost[];
  /** 恢复饥饿。 */
  nutrition: number;
  /** 恢复心情。 */
  mood: number;
}

export interface BreedingConfig {
  hatchMs: number;
  juvenileMs: number;
  elderAfterMs: number;
  cooldownMs: number;
  cost: ResourceCost[];
  mutation: {
    geneSigma: number;
    traitChance: Probability;
    elementChance: Probability;
  };
  inbreeding: {
    generations: number;
    genePenalty: number;
    mutationBonus: Probability;
    fertilityPenalty: Probability;
  };
  maxExpressedTraits: number;
  maxHiddenTraits: number;
}

/**
 * 首通 / 重复奖励的宠物模板。DOMAIN 原文是 `Id[]`，语义不明；
 * 这里内联物种+属性，避免再引一张表（C-02）。
 */
export interface PetRewardSpec {
  speciesId: Id;
  elementId: ElementId;
  gender?: Gender;
}

export interface StageReward {
  pets?: PetRewardSpec[];
  eggs?: PetRewardSpec[];
  resources?: ResourceBag;
  /** 初版：首通 30 + order×10；重复为首通的 1/3（C-06）。 */
  petExp?: number;
}

export interface StageEnemy {
  speciesId: Id;
  elementId: ElementId;
  level: number;
  /** 0~100，映射到四项基因。 */
  geneQuality: number;
  traits: Id[];
}

export interface StageConfig {
  id: Id;
  name: string;
  /** 从 1 开始，唯一。 */
  order: number;
  enemies: StageEnemy[];
  rewards: {
    firstClear?: StageReward;
    repeat?: StageReward;
  };
}

export interface EconomyConfig {
  startingResources: ResourceBag;
  /** 放生返还基因尘，公式参数（DOMAIN §8.6）。 */
  releaseRefund: {
    base: number;
    perLevel: number;
    perGeneSumDivisor: number;
    rarityBonus: Record<'common' | 'rare' | 'epic', number>;
  };
  resourceCaps?: Partial<Record<ResourceId, number>>;
}

/** 一次配置加载的完整快照；`contentVersion` 随配置变更递增。 */
export interface ConfigData {
  contentVersion: string;
  species: SpeciesConfig[];
  elements: ElementConfig[];
  affinity: AffinityTable;
  skills: SkillConfig[];
  passives: PassiveConfig[];
  traits: TraitConfig[];
  habitats: HabitatConfig[];
  foods: FoodConfig[];
  breeding: BreedingConfig;
  stages: StageConfig[];
  economy: EconomyConfig;
}

/**
 * 只读配置仓库。加载时完成校验；不做运行时热改。
 * 由 `createConfigRepo(data)` 构造（A 会话实现）。
 */
export interface ConfigRepo {
  readonly contentVersion: string;

  species(id: Id): SpeciesConfig;
  element(id: ElementId): ElementConfig;
  skill(id: Id): SkillConfig;
  passive(id: Id): PassiveConfig;
  trait(id: Id): TraitConfig;
  habitat(id: Id): HabitatConfig;
  food(id: Id): FoodConfig;
  stage(id: Id): StageConfig;
  breeding(): BreedingConfig;
  economy(): EconomyConfig;

  affinity(elementId: ElementId, speciesId: Id): Affinity;
  counterMultiplier(atkSpeciesId: Id, defSpeciesId: Id): CounterMultiplier;

  /** [普攻, 属性小技能, 属性大招, 物种技能]。 */
  skillsFor(pet: PetInstance): Id[];
  traitsFor(pet: PetInstance): TraitConfig[];

  allSpecies(): readonly SpeciesConfig[];
  allElements(): readonly ElementConfig[];
  allSkills(): readonly SkillConfig[];
  allPassives(): readonly PassiveConfig[];
  allTraits(): readonly TraitConfig[];
  allHabitats(): readonly HabitatConfig[];
  allFoods(): readonly FoodConfig[];
  allStages(): readonly StageConfig[];
}
