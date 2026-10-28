/**
 * 协议版本。不兼容变更升 v2（AGENTS §3.3，TECH_DESIGN §11.3）。
 * contract-v1 冻结于 2026-10-28。
 */
export const PROTOCOL_VERSION = 'v1' as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
