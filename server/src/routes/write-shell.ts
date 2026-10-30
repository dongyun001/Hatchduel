/**
 * 写路由公共壳：鉴权 → 幂等 → baseRevision → 执行 → 统一响应。
 *
 * 所有写端点共用这一条链路，避免各文件各写一份导致 header/幂等语义漂移。
 */
import { requireAccount } from '../http/auth-guard.js';
import type { RequestContext, ServerDeps } from '../http/context.js';
import { okReply } from '../http/reply.js';
import type { Reply } from '../http/reply.js';
import { requireBaseRevision, requireIdempotencyKey } from '../http/request.js';
import { requestFingerprint } from '../services/idempotency.js';

export interface WriteExecution {
  accountId: string;
  baseRevision: number;
}

export interface WriteOutcome {
  revision: number;
  data: unknown;
}

export async function runIdempotentWrite(
  context: RequestContext,
  deps: ServerDeps,
  routePath: string,
  fingerprint: Record<string, unknown>,
  execute: (execution: WriteExecution) => Promise<WriteOutcome>,
): Promise<Reply> {
  const account = await requireAccount(context, deps);
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', routePath, { ...fingerprint, baseRevision }),
    now: context.now,
    execute: async () => {
      const outcome = await execute({ accountId: account.id, baseRevision });
      return okReply(200, outcome.data, {
        revision: outcome.revision,
        serverTime: context.now,
      });
    },
  });
}
