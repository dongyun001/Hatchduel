/** 领域错误类型；调用方（服务端 / 客户端）按 `reason` 映射错误码。 */

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

/** 放生被拒绝的原因（DOMAIN_MODEL §8.6）。 */
export type ReleaseErrorReason =
  | 'pet_not_found'
  | 'cannot_release_egg'
  | 'pet_locked'
  | 'in_lineup'
  | 'in_habitat'
  | 'last_adult';

export class ReleaseError extends Error {
  readonly reason: ReleaseErrorReason;

  constructor(reason: ReleaseErrorReason) {
    super(`放生被拒绝：${reason}`);
    this.name = 'ReleaseError';
    this.reason = reason;
  }
}
