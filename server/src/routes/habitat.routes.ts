/**
 * 栖息地端点（ONLINE_DESIGN §5.2，contract-v1.3 D-12）。
 *
 * 六个动作全部由 `@petbattle/core` 计算：
 * - `POST /habitat/move`：放入 / 移出（`habitatId: null` 表示移出）；容量、归属、非蛋、槽位唯一都由 core 校验；
 * - `POST /habitat/collect`：`stored` 转入 `currencies`，`collected` 是领取前快照的整数部分；
 * - `POST /habitat/feed` / `clean` / `play` / `upgrade`：恢复状态、扣食物、升级栖息地。
 *
 * 服务端只做鉴权、参数形状、revision/幂等与落库；失败码由 `errors.ts` 按
 * `HabitatError.code` 映射（`INSUFFICIENT_RESOURCES` / `CAPACITY_FULL` / `NOT_FOUND` / `VALIDATION_FAILED`）。
 */
import { ROUTES } from '@petbattle/protocol';

import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import {
  asObject,
  requireNullableStringField,
  requireStringField,
} from '../http/request.js';
import type { Router } from '../http/router.js';
import { runIdempotentWrite } from './write-shell.js';

const MAX_ID_LENGTH = 128;

const ID_FIELD = { min: 1, max: MAX_ID_LENGTH } as const;

export function registerHabitatRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.movePetToHabitat.path, async (context) => movePet(context, deps));
  router.add('POST', ROUTES.collectHabitat.path, async (context) => collect(context, deps));
  router.add('POST', ROUTES.feedPet.path, async (context) => feed(context, deps));
  router.add('POST', ROUTES.cleanPet.path, async (context) => clean(context, deps));
  router.add('POST', ROUTES.playWithPet.path, async (context) => play(context, deps));
  router.add('POST', ROUTES.upgradeHabitat.path, async (context) => upgrade(context, deps));
}

async function movePet(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const petId = requireStringField(body, 'petId', { ...ID_FIELD, label: 'petId' });
  const habitatId = requireNullableStringField(body, 'habitatId', {
    ...ID_FIELD,
    label: 'habitatId',
  });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.movePetToHabitat.path,
    { petId, habitatId },
    (execution) =>
      deps.profiles.movePet({
        accountId: execution.accountId,
        petId,
        habitatId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function collect(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const habitatId = requireStringField(body, 'habitatId', { ...ID_FIELD, label: 'habitatId' });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.collectHabitat.path,
    { habitatId },
    (execution) =>
      deps.profiles.collectHabitat({
        accountId: execution.accountId,
        habitatId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function feed(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const petId = requireStringField(body, 'petId', { ...ID_FIELD, label: 'petId' });
  const foodId = requireStringField(body, 'foodId', { ...ID_FIELD, label: 'foodId' });

  return runIdempotentWrite(
    context,
    deps,
    ROUTES.feedPet.path,
    { petId, foodId },
    (execution) =>
      deps.profiles.feedPet({
        accountId: execution.accountId,
        petId,
        foodId,
        baseRevision: execution.baseRevision,
        now: context.now,
        requestId: context.requestId,
      }),
  );
}

async function clean(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const petId = requireStringField(body, 'petId', { ...ID_FIELD, label: 'petId' });

  return runIdempotentWrite(context, deps, ROUTES.cleanPet.path, { petId }, (execution) =>
    deps.profiles.cleanPet({
      accountId: execution.accountId,
      petId,
      baseRevision: execution.baseRevision,
      now: context.now,
      requestId: context.requestId,
    }),
  );
}

async function play(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const petId = requireStringField(body, 'petId', { ...ID_FIELD, label: 'petId' });

  return runIdempotentWrite(context, deps, ROUTES.playWithPet.path, { petId }, (execution) =>
    deps.profiles.playWithPet({
      accountId: execution.accountId,
      petId,
      baseRevision: execution.baseRevision,
      now: context.now,
      requestId: context.requestId,
    }),
  );
}

async function upgrade(context: RequestContext, deps: ServerDeps) {
  const body = asObject(context.body);
  const habitatId = requireStringField(body, 'habitatId', { ...ID_FIELD, label: 'habitatId' });

  return runIdempotentWrite(context, deps, ROUTES.upgradeHabitat.path, { habitatId }, (execution) =>
    deps.profiles.upgradeHabitat({
      accountId: execution.accountId,
      habitatId,
      baseRevision: execution.baseRevision,
      now: context.now,
      requestId: context.requestId,
    }),
  );
}
