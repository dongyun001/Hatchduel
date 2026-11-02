/**
 * 排行榜端点（CONTRACT §7.5 F-05）。
 *
 * `GET /leaderboard?kind=rating|codex|gene|generation&seasonId=&limit=`
 * 返回前 N 名 + 自己；机器人/封禁账号不进榜。
 */
import { ROUTES } from '@petbattle/protocol';
import type { LeaderboardQuery } from '@petbattle/protocol';

import { requireAccount } from '../http/auth-guard.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { okReply } from '../http/reply.js';
import type { Router } from '../http/router.js';

export function registerLeaderboardRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('GET', ROUTES.getLeaderboard.path, async (context) => leaderboard(context, deps));
}

async function leaderboard(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const query = parseQuery(context);
  const data = await deps.leaderboard.get(account.id, query, context.now);
  return okReply(200, data, { serverTime: context.now });
}

function parseQuery(context: RequestContext): LeaderboardQuery {
  const kind = context.query.get('kind') ?? '';
  const seasonId = context.query.get('seasonId');
  const limitRaw = context.query.get('limit');
  const limit = limitRaw === null ? undefined : Number(limitRaw);

  return {
    kind: kind as LeaderboardQuery['kind'],
    ...(seasonId === null ? {} : { seasonId }),
    ...(limit === undefined ? {} : { limit }),
  };
}
