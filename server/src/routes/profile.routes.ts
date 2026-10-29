/**
 * 存档端点（ONLINE_DESIGN §4/§5）。
 *
 * - `GET /profile` 只读，不推进时间（读不产生副作用）；`sinceRevision` 目前忽略，一律返回全量档
 *   （CONTRACT §10.6 的决定，见 docs/ONLINE_DESIGN.md）。
 * - `POST /profile/rename` 走统一写流水线：baseRevision 校验 → core 推进 → 落库 → patch。
 *   改名本身属于账号资料，Profile 不动；但 revision 必须推进，客户端才知道写入生效。
 */
import { ROUTES } from '@petbattle/protocol';

import { requireAccount } from '../http/auth-guard.js';
import { okReply } from '../http/reply.js';
import {
  asObject,
  requireBaseRevision,
  requireIdempotencyKey,
  requireStringField,
} from '../http/request.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import type { Router } from '../http/router.js';
import { requestFingerprint } from '../services/idempotency.js';

const DISPLAY_NAME_MAX = 24;

export function registerProfileRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('GET', ROUTES.getProfile.path, async (context) => getProfile(context, deps));
  router.add('POST', ROUTES.renameProfile.path, async (context) => renameProfile(context, deps));
}

async function getProfile(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const profile = await deps.profiles.get(account.id);
  return okReply(
    200,
    { profile, serverTime: context.now },
    { revision: profile.revision, serverTime: context.now },
  );
}

async function renameProfile(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const body = asObject(context.body);
  const displayName = requireStringField(body, 'displayName', {
    min: 1,
    max: DISPLAY_NAME_MAX,
    label: 'displayName',
  });
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.renameProfile.path, { displayName, baseRevision }),
    now: context.now,
    execute: async () => {
      const result = await deps.profiles.rename({
        accountId: account.id,
        displayName,
        baseRevision,
        now: context.now,
        requestId: context.requestId,
      });
      return okReply(200, result.data, {
        revision: result.revision,
        serverTime: context.now,
      });
    },
  });
}
