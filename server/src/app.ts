/**
 * HTTP 应用装配：统一入口、统一响应、统一错误映射。
 *
 * 处理顺序：
 * 1. `/health` 提前返回（不需要登录、不需要协议头，CI 与探针用）；
 * 2. 协议版本校验（客户端声明 v2 时明确报错，而不是静默按 v1 处理）；
 * 3. 路由匹配 → 读 JSON 体 → 处理器；
 * 4. 任何异常都映射成稳定错误码，5xx 记日志但不透堆栈。
 */
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { PROTOCOL_VERSION } from '@petbattle/protocol';

import { AppError, mapError } from './errors.js';
import type { RequestContext, RouteHandler, ServerDeps } from './http/context.js';
import { assertProtocolVersion, readJsonBody } from './http/request.js';
import { Router } from './http/router.js';
import { failReply } from './http/reply.js';
import type { RawReply, Reply } from './http/reply.js';
import { registerRoutes } from './routes/index.js';

export interface HealthPayload {
  ok: true;
  serverTime: number;
  protocolVersion: string;
}

function sendJson(res: ServerResponse, reply: Reply | RawReply, requestId: string): void {
  const body = JSON.stringify(reply.body);
  res.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-request-id': requestId,
    ...reply.headers,
  });
  res.end(body);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function createApp(deps: ServerDeps): RequestListener {
  const router = new Router<RouteHandler>();
  registerRoutes(router, deps);

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = randomUUID();
    const now = deps.clock();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = normalizePath(url.pathname);

    if (req.method === 'GET' && pathname === '/health') {
      const payload: HealthPayload = { ok: true, serverTime: now, protocolVersion: PROTOCOL_VERSION };
      // `/health` 的响应体保持 contract-v1 原样（ok/serverTime/protocolVersion），不套 ApiResponse。
      sendJson(res, { status: 200, body: payload }, requestId);
      return;
    }

    try {
      assertProtocolVersion(req);

      const method = req.method ?? 'GET';
      const match = router.match(method, pathname);
      if (match === undefined) {
        throw new AppError('NOT_FOUND', `未实现的路由：${method} ${pathname}`);
      }

      const body = method === 'GET' ? undefined : await readJsonBody(req, {
        maxBytes: deps.config.maxBodyBytes,
      });

      const context: RequestContext = {
        req,
        params: match.params,
        query: url.searchParams,
        body,
        now,
        requestId,
      };

      const reply = await match.meta(context);
      sendJson(res, reply, requestId);
    } catch (error) {
      const mapped = mapError(error);
      if (mapped.status >= 500) {
        deps.logger.error('请求失败', {
          requestId,
          method: req.method,
          path: pathname,
          code: mapped.code,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      sendJson(
        res,
        failReply(mapped.status, mapped.code, mapped.message, {
          serverTime: now,
          details: mapped.details,
        }),
        requestId,
      );
    }
  };

  return (req, res) => {
    void handle(req, res).catch((error: unknown) => {
      // 兜底：响应已发出后仍在抛错的情况，避免进程 unhandledRejection。
      deps.logger.error('未捕获的请求异常', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        try {
          sendJson(res, failReply(500, 'INTERNAL', '内部错误', { serverTime: deps.clock() }), '');
        } catch {
          res.destroy();
        }
      }
    });
  };
}
