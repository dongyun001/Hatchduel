/**
 * 幂等执行器（ONLINE_DESIGN §5.3，PITFALLS P-029）。
 *
 * 语义：
 * - 同一 `(scope, key)`：同指纹 → 原样重放第一次的响应（含 status/body），不再执行；
 * - 同一 key 不同指纹 → `IDEMPOTENCY_CONFLICT`；
 * - 只有 `status < 500` 的响应会被缓存（5xx 让客户端可以重试）；
 * - 同 key 的并发请求在进程内串行，避免双执行；跨进程依赖 `(scope,key)` 主键兜底。
 */
import { createHash } from 'node:crypto';

import type { ApiResponse } from '@petbattle/protocol';

import type { KeyedMutex } from '../concurrency.js';
import { AppError } from '../errors.js';
import type { Reply } from '../http/reply.js';
import type { Store } from '../storage/types.js';

const REPLAYED_HEADER = 'idempotency-replayed';

export interface IdempotentRequest {
  /** accountId，或 `device:<deviceId>` / `session:<id>` 这类未登录命名空间。 */
  scope: string;
  key: string;
  fingerprint: string;
  now: number;
  /**
   * 覆盖结果保留时长。认证类端点要短：缓存的 token 寿命比 key 短，
   * 重放一个已过期的 token 没有意义（客户端应当重新登录）。
   */
  ttlMs?: number;
  execute: () => Promise<Reply>;
}

export function requestFingerprint(method: string, path: string, payload: unknown): string {
  const hash = createHash('sha256');
  hash.update(method);
  hash.update('\n');
  hash.update(path);
  hash.update('\n');
  hash.update(JSON.stringify(payload ?? null));
  return hash.digest('hex');
}

export class IdempotencyService {
  constructor(
    private readonly store: Store,
    private readonly ttlMs: number,
    private readonly mutex: KeyedMutex,
  ) {}

  async run(request: IdempotentRequest): Promise<Reply> {
    const { scope, key, fingerprint, now, execute } = request;

    return this.mutex.run(`idem:${scope}:${key}`, async () => {
      const stored = await this.store.getStoredResponse(scope, key, now);
      if (stored !== undefined) {
        if (stored.fingerprint !== fingerprint) {
          throw new AppError('IDEMPOTENCY_CONFLICT', '同一 Idempotency-Key 被用于不同请求');
        }
        return {
          status: stored.status,
          body: stored.body as ApiResponse<unknown>,
          headers: { [REPLAYED_HEADER]: 'true' },
        };
      }

      const reply = await execute();
      if (reply.status < 500) {
        await this.store.putStoredResponse(scope, key, {
          status: reply.status,
          body: reply.body,
          fingerprint,
          createdAt: now,
          expiresAt: now + (request.ttlMs ?? this.ttlMs),
        });
      }
      return reply;
    });
  }
}
