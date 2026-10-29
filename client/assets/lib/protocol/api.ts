// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 统一响应包与写操作约定（TECH_DESIGN §11.2，ONLINE_DESIGN §5.1）。 */
import type { EpochMs, Profile } from '../core';
import type { ApiErrorCode } from './errors';

/** 所有写操作必须携带的幂等头。 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** 写操作的乐观锁版本头：客户端携带上次看到的 `profile.revision`。 */
export const BASE_REVISION_HEADER = 'X-Base-Revision';

/** 客户端声明自己使用的协议版本；服务端不匹配时返回 400/升级提示。 */
export const PROTOCOL_VERSION_HEADER = 'X-Protocol-Version';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

/**
 * 统一响应：成功 `ok: true` + `data`；失败 `ok: false` + `error`。
 * `revision` 是该次操作后的 profile 版本；`serverTime` 是服务器权威时间。
 */
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
  revision?: number;
  serverTime: EpochMs;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  revision?: number;
  serverTime: EpochMs;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
  revision?: number;
  serverTime: EpochMs;
}

/** 写操作请求元信息（放 header，不放 body）。 */
export interface WriteMeta {
  baseRevision: number;
  idempotencyKey: string;
}

/** `REVISION_CONFLICT` 的 details：客户端丢弃本地乐观更新，用最新档重建。 */
export interface RevisionConflictDetails {
  latestProfile: Profile;
  latestRevision: number;
}
