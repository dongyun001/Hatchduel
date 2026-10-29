/**
 * 鉴权守卫：从 `Authorization: Bearer <token>` 解析并校验会话。
 * 每个需要登录的端点都显式调用，不做全局中间件——路由表就是权限边界。
 */
import { AppError } from '../errors.js';
import type { AccountRecord } from '../storage/types.js';
import type { RequestContext, ServerDeps } from './context.js';
import { readBearerToken } from './request.js';

export async function requireAccount(
  context: RequestContext,
  deps: ServerDeps,
): Promise<AccountRecord> {
  const token = readBearerToken(context.req);
  if (token === undefined) {
    throw new AppError('UNAUTHENTICATED', '缺少 Authorization: Bearer 头');
  }
  return deps.auth.authenticate(token, context.now);
}
