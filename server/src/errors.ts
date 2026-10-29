/**
 * 错误映射：领域错误 → 稳定错误码 + HTTP 状态（TECH_DESIGN §11.3，CONTRACT §4.2）。
 *
 * 客户端只看 `code`，不解析文案；`message` 只用于日志与排障。
 * 未知异常一律 `INTERNAL 500`，不把堆栈/内部细节透给客户端。
 */
import { ConfigValidationError, CoreNotImplementedError, ReleaseError, TimeError } from '@petbattle/core';
import type { ReleaseErrorReason } from '@petbattle/core';
import type { ApiErrorCode } from '@petbattle/protocol';

/** 每个稳定错误码的默认 HTTP 状态；端点可显式覆盖。 */
export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  TIME_BACKWARDS: 400,
  NOT_IMPLEMENTED: 501,
  INTERNAL: 500,
  CONFIG_INVALID: 500,
  INSUFFICIENT_RESOURCES: 409,
  CAPACITY_FULL: 409,
  COOLDOWN_ACTIVE: 409,
  PET_NOT_FOUND: 404,
  PET_LOCKED: 409,
  PET_IN_USE: 409,
  EGG_NOT_RELEASABLE: 409,
  LAST_ADULT: 409,
  INVALID_LINEUP: 400,
  STAGE_LOCKED: 403,
  BATTLE_NOT_FOUND: 404,
  BATTLE_FINISHED: 409,
  ALREADY_CLAIMED: 409,
};

/** `ReleaseError.reason` → 协议错误码（CONTRACT §8.3）。 */
const RELEASE_ERROR_MAP: Record<ReleaseErrorReason, { status: number; code: ApiErrorCode }> = {
  pet_not_found: { status: 404, code: 'PET_NOT_FOUND' },
  cannot_release_egg: { status: 409, code: 'EGG_NOT_RELEASABLE' },
  pet_locked: { status: 409, code: 'PET_LOCKED' },
  in_lineup: { status: 409, code: 'PET_IN_USE' },
  in_habitat: { status: 409, code: 'PET_IN_USE' },
  last_adult: { status: 409, code: 'LAST_ADULT' },
};

export interface AppErrorOptions {
  status?: number;
  details?: unknown;
}

/** 服务端主动抛出的业务错误；不继承领域错误，避免与 core 耦合。 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.details = options.details;
  }
}

export interface MappedError {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof CoreNotImplementedError) {
    return { status: STATUS_BY_CODE.NOT_IMPLEMENTED, code: 'NOT_IMPLEMENTED', message: error.message };
  }

  if (error instanceof TimeError) {
    return { status: STATUS_BY_CODE.TIME_BACKWARDS, code: 'TIME_BACKWARDS', message: error.message };
  }

  if (error instanceof ReleaseError) {
    const mapped = RELEASE_ERROR_MAP[error.reason];
    return { status: mapped.status, code: mapped.code, message: error.message };
  }

  if (error instanceof ConfigValidationError) {
    return {
      status: STATUS_BY_CODE.CONFIG_INVALID,
      code: 'CONFIG_INVALID',
      message: error.message,
      details: { issues: error.issues },
    };
  }

  // 未知异常：只给稳定错误码，不透内部信息（原始消息由 app 记日志）。
  return { status: STATUS_BY_CODE.INTERNAL, code: 'INTERNAL', message: '内部错误' };
}
