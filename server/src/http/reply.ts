/**
 * 统一响应构造（CONTRACT §4.1）：所有响应套 `ApiResponse<T>`，并带服务器权威时间。
 * 路由处理器只返回 `Reply`，由 `app` 统一序列化，避免各处手写 header/编码。
 */
import type { ApiErrorCode, ApiResponse } from '@petbattle/protocol';

export interface ReplyMeta {
  serverTime: number;
  /** 写操作后的 profile 版本。 */
  revision?: number;
}

export interface Reply {
  status: number;
  body: ApiResponse<unknown>;
  headers?: Record<string, string>;
}

/**
 * 非 `ApiResponse` 响应。目前只有 `/health`：contract-v1 冻结的响应体是
 * `{ ok, serverTime, protocolVersion }`，不能套成 `{ data: ... }`。
 */
export interface RawReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function okReply(status: number, data: unknown, meta: ReplyMeta): Reply {
  return {
    status,
    body: { ok: true, data, serverTime: meta.serverTime, revision: meta.revision },
  };
}

export function failReply(
  status: number,
  code: ApiErrorCode,
  message: string,
  meta: ReplyMeta & { details?: unknown },
): Reply {
  return {
    status,
    body: {
      ok: false,
      error: { code, message, details: meta.details },
      serverTime: meta.serverTime,
      revision: meta.revision,
    },
  };
}
