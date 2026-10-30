/**
 * PvE 端点（ONLINE_DESIGN §6，CONTRACT §7.4）。
 *
 * - `POST /battle/pve/start`：`{ stageId }` → `{ battleId, stageId, setup, expiresAt }`；
 * - `POST /battle/pve/claim`：`{ battleId, commands }` → `{ patch, winner, rewards }`。
 *
 * 客户端只交动作（有序指令），服务端用 setup 快照重放复算，绝不接受“我赢了”。
 */
import { ROUTES } from '@petbattle/protocol';

import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { asObject, requireStringField } from '../http/request.js';
import type { Router } from '../http/router.js';
import { runIdempotentWrite } from './write-shell.js';

const MAX_ID_LENGTH = 128;

export function registerBattleRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.startPveBattle.path, async (context) => startPve(context, deps));
  router.add('POST', ROUTES.claimPveBattle.path, async (context) => claimPve(context, deps));
}

async function startPve(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const stageId = requireStringField(body, 'stageId', {
    min: 1,
    max: MAX_ID_LENGTH,
    label: 'stageId',
  });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.startPveBattle.path,
    { stageId },
    (execution) =>
      deps.battles.startPve({
        accountId: execution.accountId,
        stageId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function claimPve(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const battleId = requireStringField(body, 'battleId', {
    min: 1,
    max: MAX_ID_LENGTH,
    label: 'battleId',
  });
  const commands = body['commands'];

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.claimPveBattle.path,
    { battleId, commands },
    (execution) =>
      deps.battles.claimPve({
        accountId: execution.accountId,
        battleId,
        commands,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}
