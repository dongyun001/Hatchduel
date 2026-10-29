/**
 * 宠物操作端点（ONLINE_DESIGN §5.2）：
 *
 * - `POST /pets/:id/rename`：改名（归属 + 长度校验；名字只是展示字段，不参与任何计算）；
 * - `POST /pets/:id/lock`：锁定/解锁（只是标记位，拒绝理由由 core 在放生时判定）；
 * - `POST /pets/:id/release`：放生，五类拒绝与返还金额全部由 `core.releasePet` 决定；
 *   服务端只做「调用 core → 写回返还 → 落库 → 审计」。
 *
 * 三个端点都要求 `Idempotency-Key` + `X-Base-Revision`，走统一写流水线。
 */
import { ROUTES } from '@petbattle/protocol';

import { requireAccount } from '../http/auth-guard.js';
import type { RequestContext, RouteHandler, ServerDeps } from '../http/context.js';
import { okReply } from '../http/reply.js';
import {
  asObject,
  requireBaseRevision,
  requireBooleanField,
  requireIdempotencyKey,
  requireStringField,
} from '../http/request.js';
import type { Router } from '../http/router.js';
import { AppError } from '../errors.js';
import { requestFingerprint } from '../services/idempotency.js';

/** 宠物名上限：像素 UI 单行展示，初版由服务端定；PRD 若有正式口径再调。 */
export const PET_NAME_MAX = 12;

const MAX_PET_ID_LENGTH = 128;

export function registerPetRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  router.add('POST', ROUTES.renamePet.path, async (context) => renamePet(context, deps));
  router.add('POST', ROUTES.setPetLock.path, async (context) => setPetLock(context, deps));
  router.add('POST', ROUTES.releasePet.path, async (context) => releasePet(context, deps));
}

function requirePetId(context: RequestContext): string {
  const petId = context.params['id'];
  if (petId === undefined || petId.trim() === '') {
    throw new AppError('VALIDATION_FAILED', '缺少宠物 id');
  }
  if (petId.length > MAX_PET_ID_LENGTH) {
    throw new AppError('VALIDATION_FAILED', `宠物 id 过长（上限 ${MAX_PET_ID_LENGTH}）`);
  }
  return petId;
}

async function renamePet(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const petId = requirePetId(context);
  const body = asObject(context.body);
  const name = requireStringField(body, 'name', { min: 1, max: PET_NAME_MAX, label: 'name' });
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.renamePet.path, { petId, name, baseRevision }),
    now: context.now,
    execute: async () => {
      const result = await deps.profiles.renamePet({
        accountId: account.id,
        petId,
        name,
        baseRevision,
        now: context.now,
        requestId: context.requestId,
      });
      return okReply(200, result.data, { revision: result.revision, serverTime: context.now });
    },
  });
}

async function setPetLock(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const petId = requirePetId(context);
  const body = asObject(context.body);
  const locked = requireBooleanField(body, 'locked');
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.setPetLock.path, { petId, locked, baseRevision }),
    now: context.now,
    execute: async () => {
      const result = await deps.profiles.setPetLock({
        accountId: account.id,
        petId,
        locked,
        baseRevision,
        now: context.now,
        requestId: context.requestId,
      });
      return okReply(200, result.data, { revision: result.revision, serverTime: context.now });
    },
  });
}

async function releasePet(context: RequestContext, deps: ServerDeps) {
  const account = await requireAccount(context, deps);
  const petId = requirePetId(context);
  const idempotencyKey = requireIdempotencyKey(context.req);
  const baseRevision = requireBaseRevision(context.req);

  return deps.idempotency.run({
    scope: account.id,
    key: idempotencyKey,
    fingerprint: requestFingerprint('POST', ROUTES.releasePet.path, { petId, baseRevision }),
    now: context.now,
    execute: async () => {
      const result = await deps.profiles.releasePet({
        accountId: account.id,
        petId,
        baseRevision,
        now: context.now,
        requestId: context.requestId,
      });
      return okReply(200, result.data, { revision: result.revision, serverTime: context.now });
    },
  });
}
