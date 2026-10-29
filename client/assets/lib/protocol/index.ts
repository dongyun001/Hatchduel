// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * `@petbattle/protocol` 公共契约（contract-v1，冻结于 2026-10-28）。
 *
 * 只有 DTO、错误码、端点常量与版本号；不含业务逻辑。
 * 领域类型（PetInstance / Profile / BattleSetup…）的唯一定义在 `@petbattle/core`，
 * 本包只 re-export，禁止复制（PITFALLS P-030）。
 */
export * from './version';
export * from './errors';
export * from './api';
export * from './auth';
export * from './profile';
export * from './habitat';
export * from './pets';
export * from './breeding';
export * from './battle';
export * from './lineup';
export * from './pvp';
export * from './leaderboard';
export * from './friends';
export * from './endpoints';
