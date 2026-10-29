// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 协议版本。不兼容变更升 v2（AGENTS §3.3，TECH_DESIGN §11.3）。
 * contract-v1 冻结于 2026-10-28。
 */
export const PROTOCOL_VERSION = 'v1' as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
