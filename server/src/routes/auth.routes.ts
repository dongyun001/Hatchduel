/**
 * 认证端点（ONLINE_DESIGN §3）。
 *
 * 两个端点都是写路由（protocol `WRITE_ROUTE_KEYS`），必须带 `Idempotency-Key`：
 * 客户端重试/双击时返回第一次的 token，不会多发一次会话。
 *
 * 幂等命名空间：
 * - 游客登录：`device:<deviceId>`（此时还没有 accountId）；
 * - 刷新：`refresh:<sha256(refreshToken)>`。
 */
import { ROUTES } from '@petbattle/protocol';

import { okReply } from '../http/reply.js';
import { asObject, requireIdempotencyKey, requireStringField } from '../http/request.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import type { Router } from '../http/router.js';
import { requestFingerprint } from '../services/idempotency.js';

const MAX_REFRESH_TOKEN_LENGTH = 4096;

/**
 * 认证响应只缓存 5 分钟：access token 2 小时就过期，
 * 让幂等窗口远短于 token 寿命，避免“重放一个已过期 token”。
 */
export const AUTH_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

export function registerAuthRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.authGuest.path, async (context) => guestLogin(context, deps));
  router.add('POST', ROUTES.authRefresh.path, async (context) => refresh(context, deps));
}

async function guestLogin(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const deviceId = requireStringField(body, 'deviceId', { min: 1, max: 128, label: 'deviceId' });
  const idempotencyKey = requireIdempotencyKey(context.req);

  return deps.idempotency.run({
    scope: `device:${deviceId}`,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.authGuest.path, { deviceId }),
    now: context.now,
    ttlMs: AUTH_IDEMPOTENCY_TTL_MS,
    execute: async () => {
      const data = await deps.auth.guestLogin(deviceId, context.now);
      return okReply(200, data, { revision: data.profileRevision, serverTime: context.now });
    },
  });
}

async function refresh(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const refreshToken = requireStringField(body, 'refreshToken', {
    min: 1,
    max: MAX_REFRESH_TOKEN_LENGTH,
    label: 'refreshToken',
  });
  const idempotencyKey = requireIdempotencyKey(context.req);

  return deps.idempotency.run({
    scope: `refresh:${deps.tokens.hash(refreshToken)}`,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.authRefresh.path, {
      refreshTokenHash: deps.tokens.hash(refreshToken),
    }),
    now: context.now,
    ttlMs: AUTH_IDEMPOTENCY_TTL_MS,
    execute: async () => {
      const data = await deps.auth.refresh(refreshToken, context.now);
      return okReply(200, data, { revision: data.profileRevision, serverTime: context.now });
    },
  });
}
