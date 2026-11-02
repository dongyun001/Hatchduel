/** 领域错误类型；调用方（服务端 / 客户端）按 `reason` 映射错误码。 */
import type { BreedError } from './api.js';

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

/** PvE 指令重放失败（contract-v1.5 E-08）。 */
export type BattleReplayErrorReason = 'invalid_command' | 'not_finished';

export class BattleReplayError extends Error {
  readonly reason: BattleReplayErrorReason;

  constructor(reason: BattleReplayErrorReason) {
    super(`战斗重放失败：${reason}`);
    this.name = 'BattleReplayError';
    this.reason = reason;
  }
}

/** 繁殖蛋领取失败（contract-v1.5 E-07）。 */
export type BreedingClaimErrorReason = 'not_found' | 'egg_not_ready' | 'already_claimed';

export class BreedingClaimError extends Error {
  readonly reason: BreedingClaimErrorReason;

  constructor(reason: BreedingClaimErrorReason) {
    super(`领取繁殖蛋失败：${reason}`);
    this.name = 'BreedingClaimError';
    this.reason = reason;
  }
}

/**
 * 防守快照校验失败（contract-v1.6 F-01/F-09）。
 * 服务端统一映射 `INVALID_LINEUP`；锁定不阻止进防守。
 */
export type DefenseErrorReason = 'invalid_count' | 'duplicate' | 'pet_not_found' | 'pet_is_egg';

export class DefenseError extends Error {
  readonly reason: DefenseErrorReason;

  constructor(reason: DefenseErrorReason) {
    super(`防守快照被拒绝：${reason}`);
    this.name = 'DefenseError';
    this.reason = reason;
  }
}
