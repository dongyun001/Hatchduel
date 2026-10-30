// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/** 领域错误类型；调用方（服务端 / 客户端）按 `reason` 映射错误码。 */
import type { BreedError } from './api';

/** M0 契约桩：函数签名已冻结，实现由 A 会话按里程碑补齐。 */
export class CoreNotImplementedError extends Error {
  constructor(fn: string) {
    super(`@petbattle/core: "${fn}" 尚未实现（M0 契约桩）`);
    this.name = 'CoreNotImplementedError';
  }
}

export type TimeErrorReason = 'time_backwards';

export class TimeError extends Error {
  readonly reason: TimeErrorReason;

  constructor(reason: TimeErrorReason) {
    super(`时间倒退：${reason}`);
    this.name = 'TimeError';
    this.reason = reason;
  }
}

/** 放生被拒绝的原因（DOMAIN_MODEL §8.6；`in_defense` 为 contract-v1.3 D-11）。 */
export type ReleaseErrorReason =
  | 'pet_not_found'
  | 'cannot_release_egg'
  | 'pet_locked'
  | 'in_lineup'
  | 'in_habitat'
  | 'in_defense'
  | 'last_adult';

export class ReleaseError extends Error {
  readonly reason: ReleaseErrorReason;

  constructor(reason: ReleaseErrorReason) {
    super(`放生被拒绝：${reason}`);
    this.name = 'ReleaseError';
    this.reason = reason;
  }
}

/**
 * 繁殖编排失败原因：复用 `BreedError`，另加 `not_found`（父母 id 不在存档里）。
 * contract-v1.4 D-17。
 */
export type BreedingErrorReason = BreedError | 'not_found';

export class BreedingError extends Error {
  readonly reason: BreedingErrorReason;

  constructor(reason: BreedingErrorReason) {
    super(`繁殖被拒绝：${reason}`);
    this.name = 'BreedingError';
    this.reason = reason;
  }
}
