/**
 * `@petbattle/protocol` 公共契约（contract-v1，冻结于 2026-10-28）。
 *
 * 只有 DTO、错误码、端点常量与版本号；不含业务逻辑。
 * 领域类型（PetInstance / Profile / BattleSetup…）的唯一定义在 `@petbattle/core`，
 * 本包只 re-export，禁止复制（PITFALLS P-030）。
 */
export * from './version.js';
export * from './errors.js';
export * from './api.js';
export * from './auth.js';
export * from './profile.js';
export * from './habitat.js';
export * from './pets.js';
export * from './breeding.js';
export * from './battle.js';
export * from './lineup.js';
export * from './pvp.js';
export * from './leaderboard.js';
export * from './friends.js';
export * from './endpoints.js';
