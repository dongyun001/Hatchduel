/**
 * 异步 PvP 端点（CONTRACT §7.5）。
 *
 * - `POST /pvp/defense`：设置防守阵容（写操作，快照与存档同事务）；
 * - `GET /pvp/defense`：读取防守快照（未设置返回缺省；过期 stale=true）；
 * - `GET /pvp/opponent`：服务端选对手（匹配不消耗次数）；
 * - `POST /pvp/fight`：服务器全自动结算并落战报；
 * - `GET /pvp/replay/:id`：仅攻守双方可读。
 */
import { ROUTES } from '@petbattle/protocol';

import { requireAccount } from '../http/auth-guard.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { okReply } from '../http/reply.js';
import { asObject } from '../http/request.js';
import type { Router } from '../http/router.js';
import { runIdempotentWrite } from './write-shell.js';

export function registerPvpRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.setPvpDefense.path, async (context) => setDefense(context, deps));
  router.add('GET', ROUTES.getPvpDefense.path, async (context) => getDefense(context, deps));
  router.add('GET', ROUTES.getPvpOpponent.path, async (context) => getOpponent(context, deps));
  router.add('POST', ROUTES.fightPvp.path, async (context) => fight(context, deps));
  router.add('GET', ROUTES.getPvpReplay.path, async (context) => replay(context, deps));
}

async function setDefense(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const petIds = body['petIds'];

  return runIdempotentWrite(context, deps, ROUTES.setPvpDefense.path, { petIds }, (execution) =>
    deps.pvp.setDefense({
      accountId: execution.accountId,
      petIds,
      baseRevision: execution.baseRevision,
      now: context.now,
      requestId: context.requestId,
    }),
  );
}

async function getDefense(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const data = await deps.pvp.getDefense(account.id, context.now);
  return okReply(200, data, { serverTime: context.now });
}

async function getOpponent(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const data = await deps.pvp.getOpponent(account.id, context.now);
  return okReply(200, data, { serverTime: context.now });
}

async function fight(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const opponentAccountId = body['opponentAccountId'];

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.fightPvp.path,
    { opponentAccountId },
    (execution) =>
      deps.pvp.fight({
        accountId: execution.accountId,
        opponentAccountId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function replay(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const data = await deps.pvp.getReplay(account.id, context.params['id'], context.now);
  return okReply(200, data, { serverTime: context.now });
}
