import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Profile } from '@petbattle/core';
import type { GetProfileResponse, ProfileWriteResponse, RevisionConflictDetails } from '@petbattle/protocol';

import { STARTER_PET_SPECS } from '../src/domain/starter-profile.js';
import { testConfigRepo } from './fixtures.js';
import {
  authHeaders,
  expectError,
  get,
  guestLogin,
  post,
  startTestServer,
  type TestHarness,
} from './helpers.js';

let harness: TestHarness;
let token: string;

beforeEach(async () => {
  harness = await startTestServer();
  const login = await guestLogin(harness, 'device-profile');
  token = login.data.token;
});

afterEach(async () => {
  await harness.close();
});

async function readProfile(): Promise<GetProfileResponse> {
  const call = await get(harness, '/profile', authHeaders(token));
  expect(call.status).toBe(200);
  return call.body.data as GetProfileResponse;
}

function rename(displayName: string, baseRevision: number, key: string) {
  return post(
    harness,
    '/profile/rename',
    { displayName },
    { ...authHeaders(token), 'idempotency-key': key, 'x-base-revision': String(baseRevision) },
  );
}

describe('GET /profile', () => {
  it('未登录返回 401', async () => {
    const call = await get(harness, '/profile');
    expect(call.status).toBe(401);
    expectError(call, 'UNAUTHENTICATED');
  });

  it('返回服务器权威存档与 revision', async () => {
    const repo = await testConfigRepo();
    const call = await get(harness, '/profile', authHeaders(token));
    expect(call.status).toBe(200);
    expect(call.body.revision).toBe(0);

    const data = call.body.data as GetProfileResponse;
    expect(data.profile.revision).toBe(0);
    expect(data.profile.currencies.coin).toBe(repo.economy().startingResources.coin ?? 0);
    expect(Object.keys(data.profile.pets)).toHaveLength(STARTER_PET_SPECS.length);
    expect(data.serverTime).toBe(harness.clock.now());
  });
});

describe('POST /profile/rename', () => {
  it('成功改名：revision +1，返回 patch', async () => {
    const call = await rename('新名字', 0, 'rename-1');
    expect(call.status).toBe(200);
    expect(call.body.revision).toBe(1);

    const data = call.body.data as ProfileWriteResponse;
    expect(data.revision).toBe(1);
    expect(data.patch.fromRevision).toBe(0);
    expect(data.patch.toRevision).toBe(1);

    const after = await readProfile();
    expect(after.profile.revision).toBe(1);
  });

  it('缺 Idempotency-Key 返回 VALIDATION_FAILED', async () => {
    const call = await post(
      harness,
      '/profile/rename',
      { displayName: 'x' },
      { ...authHeaders(token), 'x-base-revision': '0' },
    );
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('缺 baseRevision 返回 VALIDATION_FAILED', async () => {
    const call = await post(
      harness,
      '/profile/rename',
      { displayName: 'x' },
      { ...authHeaders(token), 'idempotency-key': 'rename-no-rev' },
    );
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('未登录优先返回 401', async () => {
    const call = await post(
      harness,
      '/profile/rename',
      { displayName: 'x' },
      { 'idempotency-key': 'k', 'x-base-revision': '0' },
    );
    expect(call.status).toBe(401);
    expectError(call, 'UNAUTHENTICATED');
  });

  it('displayName 为空返回 VALIDATION_FAILED', async () => {
    const call = await rename('   ', 0, 'rename-empty');
    expect(call.status).toBe(400);
    expectError(call, 'VALIDATION_FAILED');
  });

  it('baseRevision 过期返回 409 + 最新快照', async () => {
    await rename('first', 0, 'rename-1');

    const stale = await rename('second', 0, 'rename-2');
    expect(stale.status).toBe(409);
    expectError(stale, 'REVISION_CONFLICT');

    const details = stale.body.error?.details as RevisionConflictDetails;
    expect(details.latestRevision).toBe(1);
    expect(details.latestProfile.revision).toBe(1);
    expect((details.latestProfile as Profile).accountId).toBeTruthy();
  });

  it('同 key 重放返回第一次结果，不重复推进 revision', async () => {
    const first = await rename('same', 0, 'rename-replay');
    const replay = await rename('same', 0, 'rename-replay');

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');

    const after = await readProfile();
    expect(after.profile.revision).toBe(1);
  });

  it('同 key 不同请求体视为冲突', async () => {
    await rename('a', 0, 'rename-key');
    const conflict = await rename('b', 0, 'rename-key');
    expect(conflict.status).toBe(409);
    expectError(conflict, 'IDEMPOTENCY_CONFLICT');
  });

  it('并发两次同 baseRevision：一个成功、一个 409', async () => {
    const results = await Promise.all([
      rename('并发A', 0, 'rename-concurrent-a'),
      rename('并发B', 0, 'rename-concurrent-b'),
    ]);

    const statuses = results.map((result) => result.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const after = await readProfile();
    expect(after.profile.revision).toBe(1);
  });

  it('改名写入审计日志', async () => {
    await rename('审计', 0, 'rename-audit');
    const audits = harness.store.listAudits();
    expect(audits.some((entry) => entry.action === 'profile.rename')).toBe(true);
  });

  it('改名后重新登录能看到新名字', async () => {
    await rename('改名之后', 0, 'rename-display');
    const again = await guestLogin(harness, 'device-profile', 'login-after-rename');
    expect(again.data.account.displayName).toBe('改名之后');
  });
});
