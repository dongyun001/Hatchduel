/**
 * 服务端集成测试脚手架：内存存储 + 可控时钟 + 静默日志 + 真实 HTTP 端口。
 *
 * 用真实 `fetch` 打真实 socket，覆盖 header 解析、JSON 编码、状态码这些
 * “只有走完整链路才会错”的部分。
 */
import type { ApiResponse, AuthResponse } from '@petbattle/protocol';

import { loadConfig } from '../src/config.js';
import type { ServerConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { startServer } from '../src/server.js';
import { InMemoryStore } from '../src/storage/memory.js';

export const TEST_TOKEN_SECRET = 'test-secret-0123456789';
export const START_TIME = 1_700_000_000_000;

export interface TestClock {
  advance(ms: number): void;
  set(ms: number): void;
  now(): number;
}

export interface TestHarness {
  baseUrl: string;
  store: InMemoryStore;
  clock: TestClock;
  close(): Promise<void>;
}

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadConfig({}),
    tokenSecret: TEST_TOKEN_SECRET,
    pg: { connectionString: undefined, maxPoolSize: 10 },
    ...overrides,
  };
}

export async function startTestServer(overrides: Partial<ServerConfig> = {}): Promise<TestHarness> {
  const store = new InMemoryStore();
  let now = START_TIME;
  const clock: TestClock = {
    advance: (ms) => {
      now += ms;
    },
    set: (ms) => {
      now = ms;
    },
    now: () => now,
  };

  const running = await startServer(0, {
    config: testConfig(overrides),
    store,
    logger: silentLogger,
    clock: () => now,
  });

  return {
    baseUrl: `http://127.0.0.1:${running.port}`,
    store,
    clock,
    close: () => running.close(),
  };
}

export interface HttpCall {
  status: number;
  headers: Headers;
  body: ApiResponse<unknown>;
}

async function finish(response: Response): Promise<HttpCall> {
  const body = (await response.json()) as ApiResponse<unknown>;
  return { status: response.status, headers: response.headers, body };
}

export function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

export function post(
  harness: TestHarness,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpCall> {
  return fetch(`${harness.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(finish);
}

export function get(
  harness: TestHarness,
  path: string,
  headers: Record<string, string> = {},
): Promise<HttpCall> {
  return fetch(`${harness.baseUrl}${path}`, { method: 'GET', headers }).then(finish);
}

export interface GuestLoginResult {
  call: HttpCall;
  data: AuthResponse;
}

export async function guestLogin(
  harness: TestHarness,
  deviceId: string,
  idempotencyKey = `login-${deviceId}`,
): Promise<GuestLoginResult> {
  const call = await post(harness, '/auth/guest', { deviceId }, { 'idempotency-key': idempotencyKey });
  return { call, data: call.body.data as AuthResponse };
}

/** 断言错误响应的稳定错误码。 */
export function expectError(call: HttpCall, code: string): void {
  if (call.body.ok) throw new Error(`期望失败响应，实际成功：${JSON.stringify(call.body)}`);
  const actual = call.body.error?.code;
  if (actual !== code) {
    throw new Error(`期望错误码 ${code}，实际 ${String(actual)}`);
  }
}
