/** sim 报告的数据结构；渲染层（report.ts）只消费这些类型。 */

export type SimStatus = 'ok' | 'unavailable';
export type CheckLevel = 'pass' | 'warn' | 'fail';

export interface SimCheck {
  id: string;
  level: CheckLevel;
  detail: string;
}

export interface StaticAnalysis {
  contentVersion: string;
  counts: {
    species: number;
    elements: number;
    skills: number;
    passives: number;
    traits: number;
    habitats: number;
    foods: number;
    stages: number;
    codexCombos: number;
  };
  traitsByRarity: Record<'common' | 'rare' | 'epic', number>;
  stageExp: Array<{
    stageId: string;
    order: number;
    firstClear: number;
    repeat: number;
    expectedFirst: number;
    expectedRepeat: number;
  }>;
  economy: {
    startingCoin: number;
    startingFood: number;
    startingGeneDust: number;
    breedingCoin: number;
    breedingFood: number;
    foodNetPerHourAtCapacity: number;
    coinPerHourAtCapacity: number;
    geneDustPerHourAtCapacity: number;
    firstClearCoinTotal: number;
    firstClearDustTotal: number;
    upgrade2Coin: number;
    upgrade2Dust: number;
    minReleaseDust: number;
    maxReleaseDust: number;
  };
  checks: SimCheck[];
  notes: string[];
}

/** 一场战斗的聚合结果。 */
export interface StageBattleStats {
  stageId: string;
  battles: number;
  winRate: number;
  drawRate: number;
  avgTurns: number;
}

export interface BattleMetrics {
  status: SimStatus;
  reason?: string;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  drawRate: number;
  avgTurns: number;
  minTurns: number;
  maxTurns: number;
  /** 每个单位每回合释放小技能的比例；>1 表示小技能过强（P-002）。 */
  smallCastsPerUnitTurn: number;
  ultimateCastsPerUnitTurn: number;
  /** 同一单位两次大招之间的平均回合数；目标约 3 回合。 */
  avgUltimateInterval: number;
  invalidNumbers: number;
  perStage: StageBattleStats[];
}

export interface EconomyPoint {
  hour: number;
  coin: number;
  food: number;
  geneDust: number;
  storedCoin: number;
  avgHunger: number;
  avgHealth: number;
}

export interface EconomyCurve {
  status: SimStatus;
  reason?: string;
  days: number;
  /** 每 8 小时一个点（离线封顶）。 */
  points: EconomyPoint[];
  dayEnd: EconomyPoint[];
  totalCoin: number;
  totalFood: number;
  totalGeneDust: number;
  /** 24h 单次推进产出的金币 / 8h 单次推进产出；≈1 说明离线封顶生效。 */
  offlineCapRatio: number;
  offlineCapVerified: boolean;
  /** 曲线里是否有负值（不应出现）。 */
  hasNegativeValues: boolean;
}

export interface GeneSummary {
  mean: Record<'hp' | 'atk' | 'def' | 'spd', number>;
  std: Record<'hp' | 'atk' | 'def' | 'spd', number>;
}

export interface BreedingGroup {
  samples: number;
  gene: GeneSummary;
  mutationRate: number;
  avgExpressedTraits: number;
}

export interface BreedingStats {
  status: SimStatus;
  reason?: string;
  samples: number;
  species: Record<string, number>;
  element: Record<string, number>;
  overall: BreedingGroup;
  /** 随机 founder 配对中的近亲比例；founder 互不相关，预期 0。 */
  randomInbredRate: number;
  /** 构造出的近亲配对（父 × 亲女）中被 `isInbred` 判定的比例；预期 1。 */
  inbredRate: number;
  /** 对照组（亲女 × 无关 founder）中被误判为近亲的比例；预期 0。 */
  controlInbredRate: number;
  /** 子代 `ancestors` 是否真的带上了父母（否则近亲判定不可能成立）。 */
  ancestorVerified: boolean;
  inbred: BreedingGroup | null;
  control: BreedingGroup | null;
  invalidNumbers: number;
}

export interface BalanceReport {
  generatedAt: string;
  contentVersion: string;
  seed: number;
  static: StaticAnalysis;
  battle: BattleMetrics;
  economy: EconomyCurve;
  breeding: BreedingStats;
}
