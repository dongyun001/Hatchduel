import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthResponse } from '@petbattle/protocol';

import {
  expectError,
  guestLogin,
  post,
  startTestServer,
  type HttpCall,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;

beforeEach(async () => {
  harness = await startTestServer();
});

afterEach(async () => {
  await harness.close();
});

describe('POST /auth/guest', () => {
  it('首次登录创建账号并返回 token + 初始 revision', async () => {
    const { call, data } = await guestLogin(harness, 'device-a');

    expect(call.status).toBe(200);
    expect(call.body.ok).toBe(true);
    expect(typeof data.token).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.account.bindings.guest?.deviceId).toBe('device-a');
    expect(data.profileRevision).toBe(0);
    expect(data.serverTime).toBe(harness.clock.now());
  });

  it('同一 deviceId 用不同幂等 key 登录仍是同一账号', async () => {
    const first = await guestLogin(harness, 'device-a', 'key-1');
    const second = await guestLogin(harness, 'device-a', 'key-2');

    expect(second.data.account.id).toBe(first.data.account.id);
    // 每次都发新会话，token 不同。
    expect(second.data.token).not.toBe(first.data.token);
  });

  it('不同 deviceId 得到不同账号', async () => {
    const first = await guestLogin(harness, 'device-a');
    const second = await guestLogin(harness, 'device-b');
    expect(second.data.account.id).not.toBe(first.data.account.id);
  });

  it('同一幂等 key 重放返回完全一致的响应，且不新建会话', async () => {
    const first = await guestLogin(harness, 'device-a', 'same-key');
    const replay = await guestLogin(harness, 'device-a', 'same-key');

    expect(replay.call.status).toBe(200);
    expect(replay.call.headers.get('idempotency-replayed')).toBe('true');
    expect(replay.call.body).toEqual(first.call.body);
    expect(replay.data.token).toBe(first.data.token);
    expect(replay.data.refreshToken).toBe(first.data.refreshToken);
  });

  it('同一 key 在不同设备上互不影响（游客幂等命名空间按设备隔离）', async () => {
    const first = await guestLogin(harness, 'device-a', 'shared-key');
    const second = await guestLogin(harness, 'device-b', 'shared-key');

    expect(first.call.status).toBe(200);
    expect(second.call.status).toBe(200);
    expect(second.data.account.id).not.toBe(first.data.account.id);
  });

  it('认证幂等窗口只有 5 分钟，过期后同 key 重新执行并拿到新 token', async () => {
    const first = await guestLogin(harness, 'device-a', 'ttl-key');
    harness.clock.advance(6 * 60 * 1000);
    const second = await guestLogin(harness, 'device-a', 'ttl-key');

    expect(second.call.status).toBe(200);
    expect(second.call.headers.get('idempotency-replayed')).toBeNull();
    expect(second.data.token).not.toBe(first.data.token);
    // 账号不变，只是重新发会话。
    expect(second.data.account.id).toBe(first.data.account.id);
  });

  it('缺少 Idempotency-Key 返回 VALIDATION_FAILED', async () => {
    const call = await post(harness, '/auth/guest', { deviceId: 'device-a' });
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('缺少 deviceId 返回 VALIDATION_FAILED', async () => {
    const call = await post(harness, '/auth/guest', {}, { 'idempotency-key': 'k-1' });
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('不认识的协议版本直接拒绝', async () => {
    const call = await post(
      harness,
      '/auth/guest',
      { deviceId: 'device-a' },
      { 'idempotency-key': 'k-1', 'x-protocol-version': 'v2' },
    );
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('首次登录写账号创建审计，重复登录不重复写', async () => {
    await guestLogin(harness, 'device-audit', 'audit-1');
    await guestLogin(harness, 'device-audit', 'audit-2');
    const created = harness.store.listAudits().filter((entry) => entry.action === 'account.create');
    expect(created).toHaveLength(1);
  });

  it('access token 可访问受保护接口，伪造 token 返回 401', async () => {
    const { data } = await guestLogin(harness, 'device-a');

    const withToken = await fetch(`${harness.baseUrl}/profile`, {
      headers: { authorization: `Bearer ${data.token}` },
    });
    expect(withToken.status).toBe(200);

    const forged: HttpCall = await fetch(`${harness.baseUrl}/profile`, {
      headers: { authorization: `Bearer ${data.token}tampered` },
    }).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as HttpCall['body'],
    }));
    expect(forged.status).toBe(401);
    expectError(forged, 'UNAUTHENTICATED');
  });
});

describe('POST /auth/refresh', () => {
  it('刷新成功并轮换 refreshToken，旧 token 立即失效', async () => {
    const login = await guestLogin(harness, 'device-a');

    const refreshed = await post(
      harness,
      '/auth/refresh',
      { refreshToken: login.data.refreshToken },
      { 'idempotency-key': 'refresh-1' },
    );
    expect(refreshed.status).toBe(200);
    const refreshedData = refreshed.body.data as AuthResponse;
    expect(refreshedData.account.id).toBe(login.data.account.id);
    expect(refreshedData.refreshToken).not.toBe(login.data.refreshToken);

    const reuse = await post(
      harness,
      '/auth/refresh',
      { refreshToken: login.data.refreshToken },
      { 'idempotency-key': 'refresh-2' },
    );
    expect(reuse.status).toBe(401);
    expectError(reuse, 'UNAUTHENTICATED');
  });

  it('refreshToken 无效返回 401', async () => {
    const call = await post(
      harness,
      '/auth/refresh',
      { refreshToken: 'not-a-token' },
      { 'idempotency-key': 'refresh-bad' },
    );
    expect(call.status).toBe(401);
    expectError(call, 'UNAUTHENTICATED');
  });
});
