// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
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

export * from './types/common';
export * from './types/stats';
export * from './types/pet';
export * from './types/profile';
export * from './types/battle';

export * from './config/types';
export * from './config/schema';

export * from './constants';
export * from './errors';
export * from './exp';
export * from './api';
