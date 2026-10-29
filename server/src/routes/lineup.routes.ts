/**
 * 出战编队端点（ONLINE_DESIGN §5.2）。
 *
 * 校验在 `domain/lineup.ts`：最多 3 只、属于本人、引用存在、非蛋、不重复；
 * 幼年可上阵（属性由 `core.deriveStats` 在建战时按阶段系数计算）。
 * 与 PvP 防守阵容（`/pvp/defense`）互不联动。
 */
import { ROUTES } from '@petbattle/protocol';

import { requireAccount } from '../http/auth-guard.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { okReply } from '../http/reply.js';
import { asObject, requireBaseRevision, requireIdempotencyKey } from '../http/request.js';
import type { Router } from '../http/router.js';
import { requestFingerprint } from '../services/idempotency.js';

export function registerLineupRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.setLineup.path, async (context) => setLineup(context, deps));
}

async function setLineup(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const body = asObject(context.body);
  const petIds = body['petIds'];
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.setLineup.path, { petIds, baseRevision }),
    now: context.now,
    execute: async () => {
      const result = await deps.profiles.setLineup({
        accountId: account.id,
        petIds,
        baseRevision,
        now: context.now,
        requestId: context.requestId,
      });
      return okReply(200, result.data, { revision: result.revision, serverTime: context.now });
    },
  });
}
