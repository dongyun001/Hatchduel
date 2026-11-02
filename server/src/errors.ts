/**
 * 错误映射：领域错误 → 稳定错误码 + HTTP 状态（TECH_DESIGN §11.3，CONTRACT §4.2）。
 *
 * 客户端只看 `code`，不解析文案；`message` 只用于日志与排障。
 * 未知异常一律 `INTERNAL 500`，不把堆栈/内部细节透给客户端。
 */
import {
  BattleReplayError,
  BreedingClaimError,
  BreedingError,
  ConfigValidationError,
  CoreNotImplementedError,
  DefenseError,
  ReleaseError,
  TimeError,
} from '@petbattle/core';
import type {
  BreedingClaimErrorReason,
  BreedingErrorReason,
  Profile,
  ReleaseErrorReason,
} from '@petbattle/core';
import type { ApiErrorCode, RevisionConflictDetails } from '@petbattle/protocol';

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
  BATTLE_EXPIRED: 409,
  EGG_NOT_READY: 409,
  BATTLE_FINISHED: 409,
  ALREADY_CLAIMED: 409,
  // contract-v1.6 骨架：仅映射状态，PvP 端点由 C 实现
  DAILY_LIMIT_REACHED: 429,
  OPPONENT_UNAVAILABLE: 409,
  REPLAY_EXPIRED: 410,
};

/** `ReleaseError.reason` → 协议错误码（CONTRACT §8.3）。 */
const RELEASE_ERROR_MAP: Record<ReleaseErrorReason, { status: number; code: ApiErrorCode }> = {
  pet_not_found: { status: 404, code: 'PET_NOT_FOUND' },
  cannot_release_egg: { status: 409, code: 'EGG_NOT_RELEASABLE' },
  pet_locked: { status: 409, code: 'PET_LOCKED' },
  in_lineup: { status: 409, code: 'PET_IN_USE' },
  in_habitat: { status: 409, code: 'PET_IN_USE' },
  in_defense: { status: 409, code: 'PET_IN_USE' },
  last_adult: { status: 409, code: 'LAST_ADULT' },
};

/** `BreedingError.reason` → 协议错误码（CONTRACT §7.4 / §8.3）。 */
const BREEDING_ERROR_MAP: Record<BreedingErrorReason, { status: number; code: ApiErrorCode }> = {
  not_found: { status: 404, code: 'NOT_FOUND' },
  not_adult: { status: 400, code: 'VALIDATION_FAILED' },
  same_pet: { status: 400, code: 'VALIDATION_FAILED' },
  same_gender: { status: 400, code: 'VALIDATION_FAILED' },
  infertile: { status: 400, code: 'VALIDATION_FAILED' },
  cooldown: { status: 409, code: 'COOLDOWN_ACTIVE' },
  no_capacity: { status: 409, code: 'CAPACITY_FULL' },
  cost: { status: 409, code: 'INSUFFICIENT_RESOURCES' },
  locked: { status: 409, code: 'PET_LOCKED' },
};

/** `BreedingClaimError.reason` → 协议错误码（CONTRACT §7.4 E-07）。 */
const BREEDING_CLAIM_MAP: Record<BreedingClaimErrorReason, { status: number; code: ApiErrorCode }> =
  {
    not_found: { status: 404, code: 'NOT_FOUND' },
    egg_not_ready: { status: 409, code: 'EGG_NOT_READY' },
    already_claimed: { status: 409, code: 'ALREADY_CLAIMED' },
  };

/**
 * 栖息地操作失败码（DOMAIN §15.7，contract-v1.3 D-12）。
 *
 * core 抛的是普通 `Error`（`name = 'HabitatError'` + `code`），没有导出 class，
 * 这里按结构化特征识别；`code` 集合与 core 的 `HabitatErrorCode` 对齐。
 */
type HabitatErrorCode =
  | 'pet_not_found'
  | 'egg_not_allowed'
  | 'habitat_not_found'
  | 'food_not_found'
  | 'capacity_full'
  | 'insufficient_resources'
  | 'max_level'
  | 'slot_conflict';

const HABITAT_ERROR_MAP: Record<HabitatErrorCode, { status: number; code: ApiErrorCode }> = {
  pet_not_found: { status: 404, code: 'PET_NOT_FOUND' },
  habitat_not_found: { status: 404, code: 'NOT_FOUND' },
  food_not_found: { status: 404, code: 'NOT_FOUND' },
  capacity_full: { status: 409, code: 'CAPACITY_FULL' },
  insufficient_resources: { status: 409, code: 'INSUFFICIENT_RESOURCES' },
  egg_not_allowed: { status: 400, code: 'VALIDATION_FAILED' },
  max_level: { status: 400, code: 'VALIDATION_FAILED' },
  slot_conflict: { status: 400, code: 'VALIDATION_FAILED' },
};

function readHabitatErrorCode(error: unknown): HabitatErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== 'HabitatError') return undefined;
  if (typeof candidate.code !== 'string') return undefined;
  return candidate.code in HABITAT_ERROR_MAP ? (candidate.code as HabitatErrorCode) : undefined;
}

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

/** revision 冲突：带上最新快照，客户端丢弃本地乐观更新重建（CONTRACT §4.1）。 */
export function revisionConflictError(latest: Profile, expected: number): AppError {
  const details: RevisionConflictDetails = {
    latestProfile: latest,
    latestRevision: latest.revision,
  };
  return new AppError(
    'REVISION_CONFLICT',
    `revision 冲突：客户端 baseRevision=${expected}，服务器最新=${latest.revision}`,
    { details },
  );
}

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof CoreNotImplementedError) {
    return {
      status: STATUS_BY_CODE.NOT_IMPLEMENTED,
      code: 'NOT_IMPLEMENTED',
      message: error.message,
    };
  }

  if (error instanceof TimeError) {
    return {
      status: STATUS_BY_CODE.TIME_BACKWARDS,
      code: 'TIME_BACKWARDS',
      message: error.message,
    };
  }

  if (error instanceof ReleaseError) {
    const mapped = RELEASE_ERROR_MAP[error.reason];
    return { status: mapped.status, code: mapped.code, message: error.message };
  }

  if (error instanceof BreedingError) {
    const mapped = BREEDING_ERROR_MAP[error.reason];
    return { status: mapped.status, code: mapped.code, message: error.message };
  }

  if (error instanceof BreedingClaimError) {
    const mapped = BREEDING_CLAIM_MAP[error.reason];
    return { status: mapped.status, code: mapped.code, message: error.message };
  }

  if (error instanceof DefenseError) {
    // F-01/F-09：防守阵容校验失败（数量/重复/不存在/蛋）统一映射 INVALID_LINEUP。
    return {
      status: STATUS_BY_CODE.INVALID_LINEUP,
      code: 'INVALID_LINEUP',
      message: `防守阵容不合法：${error.reason}`,
    };
  }

  if (error instanceof BattleReplayError) {
    // 指令非法 / 重放未打完：都是“客户端提交的战斗过程无效”，不是服务器错误。
    return {
      status: STATUS_BY_CODE.VALIDATION_FAILED,
      code: 'VALIDATION_FAILED',
      message: error.message,
    };
  }

  const habitatCode = readHabitatErrorCode(error);
  if (habitatCode !== undefined) {
    const mapped = HABITAT_ERROR_MAP[habitatCode];
    const message = error instanceof Error ? error.message : habitatCode;
    return { status: mapped.status, code: mapped.code, message };
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
