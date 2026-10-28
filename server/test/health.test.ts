import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@petbattle/protocol';

import { startServer, type RunningServer } from '../src/server.js';

let running: RunningServer;
let baseUrl: string;

beforeAll(async () => {
  running = await startServer(0);
  baseUrl = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
});

interface HealthBody {
  ok: boolean;
  serverTime: number;
  protocolVersion: string;
}

interface NotFoundBody {
  ok: boolean;
  error: { code: string; message: string };
  serverTime: number;
}

describe('GET /health', () => {
  it('返回 ok / serverTime / protocolVersion', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = (await response.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(Number.isFinite(body.serverTime)).toBe(true);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

describe('未知路由', () => {
  it('返回 404 + 稳定错误码', async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as NotFoundBody;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
