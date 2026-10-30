/** `@petbattle/sim` 公共入口：批量战斗 / 经济曲线 / 繁殖分布 + Markdown 报告。 */
export const SIM_STATUS = 'beta' as const;

export type {
  AiMode,
  BalanceReport,
  BattleMetrics,
  BreedingGroup,
  BreedingStats,
  CheckLevel,
  EconomyCurve,
  EconomyPoint,
  GeneSummary,
  PlayerPathCurve,
  PlayerPathPoint,
  SimCheck,
  SimStatus,
  StageBattleStats,
  StaticAnalysis,
} from './types.js';

export { createRng, mulberry32 } from './rng.js';
export { loadConfig } from './config.js';
export { analyzeConfig } from './static-analysis.js';
export { runBattleBatch, unavailableBattle, type BattleBatchOptions } from './battle.js';
export { runEconomyCurve, unavailableEconomy } from './economy.js';
export { runPlayerPathCurve, unavailablePlayerPath } from './economy-path.js';
export { runBreedingBatch, unavailableBreeding, type BreedingBatchOptions } from './breeding.js';
export {
  SIM_BEGIN,
  SIM_END,
  applySimSection,
  renderConsoleSummary,
  renderSimSection,
} from './report.js';
