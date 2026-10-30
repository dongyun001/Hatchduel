/**
 * 繁殖端点（DOMAIN §8，CONTRACT §7.4 E-07）。
 *
 * - `POST /breeding/start`：`{ parentA, parentB }` → `{ egg, inbred, patch }`；
 * - `POST /breeding/claim`：`{ eggId }` → `{ pet, patch }`（蛋必须先孵化，服务端先推进时间）。
 */
import { ROUTES } from '@petbattle/protocol';

import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { asObject, requireStringField } from '../http/request.js';
import type { Router } from '../http/router.js';
import { runIdempotentWrite } from './write-shell.js';

const MAX_ID_LENGTH = 128;

export function registerBreedingRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.startBreeding.path, async (context) => start(context, deps));
  router.add('POST', ROUTES.claimBreeding.path, async (context) => claim(context, deps));
}

async function start(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const parentA = requireStringField(body, 'parentA', {
    min: 1,
    max: MAX_ID_LENGTH,
    label: 'parentA',
  });
  const parentB = requireStringField(body, 'parentB', {
    min: 1,
    max: MAX_ID_LENGTH,
    label: 'parentB',
  });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.startBreeding.path,
    { parentA, parentB },
    (execution) =>
      deps.breeding.start({
        accountId: execution.accountId,
        parentA,
        parentB,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function claim(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const eggId = requireStringField(body, 'eggId', {
    min: 1,
    max: MAX_ID_LENGTH,
    label: 'eggId',
  });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.claimBreeding.path,
    { eggId },
    (execution) =>
      deps.breeding.claim({
        accountId: execution.accountId,
        eggId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}
