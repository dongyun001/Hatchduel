/**
 * `@petbattle/core` 公共契约（contract-v1，冻结于 2026-10-28）。
 *
 * 这里只暴露类型、常量与函数签名；业务实现由 A 会话按里程碑补齐。
 * 修改任何导出 = 修改契约：必须升版本并通知 A/B/C/D（docs/CONTRACT.md §9）。
 *
 * 硬性边界：
 * - 不依赖 Cocos / 微信 / DOM / 网络 / 文件系统 / 数据库；
 * - 时间由调用方传入 `EpochMs`；随机由调用方注入 `Rng`；
 * - 纯 TS、可序列化、无副作用；禁止 `Math.random` / `Date.now`。
 */

export * from './types/common.js';
export * from './types/stats.js';
export * from './types/pet.js';
export * from './types/profile.js';
export * from './types/battle.js';

export * from './config/types.js';
export * from './config/schema.js';

export * from './constants.js';
export * from './errors.js';
export * from './exp.js';
export * from './api.js';
