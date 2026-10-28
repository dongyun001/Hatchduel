/**
 * M0 Hello 服务：只有 `/health`。
 *
 * 不接数据库 / Redis / 登录 / 云存档；这些由 C 会话在 M2 接入。
 * 服务器是权威时间来源；此处返回 `serverTime` 供客户端校准 offset。
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { PROTOCOL_VERSION } from '@petbattle/protocol';

export const DEFAULT_PORT = 3000;

export interface HealthPayload {
  ok: true;
  serverTime: number;
  protocolVersion: string;
}

export interface ErrorPayload {
  ok: false;
  error: { code: 'NOT_FOUND'; message: string };
  serverTime: number;
}

function sendJson(res: ServerResponse, status: number, payload: HealthPayload | ErrorPayload): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    const payload: HealthPayload = {
      ok: true,
      serverTime: Date.now(),
      protocolVersion: PROTOCOL_VERSION,
    };
    sendJson(res, 200, payload);
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: { code: 'NOT_FOUND', message: `未实现的路由：${req.method ?? '?'} ${url.pathname}` },
    serverTime: Date.now(),
  });
}

export function createServer(): Server {
  return createHttpServer(handle);
}

export interface RunningServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

/** 启动并解析实际端口（测试用 0 拿随机端口）。 */
export async function startServer(port = DEFAULT_PORT): Promise<RunningServer> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  return {
    server,
    port: address?.port ?? port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
