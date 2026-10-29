/* global console, process */
/**
 * 验证 ApiClient 的 409 重建与 serverTime 偏移（不依赖真实服务端）。
 *
 * 运行：pnpm exec tsx client/tools/verify-api-client.ts
 *
 * 场景：
 * 1. /auth/guest 成功，serverTime 比本机快 5s → 偏移应约 5000ms；
 * 2. /habitat/feed 返回 409 REVISION_CONFLICT，details.latestProfile revision=8；
 * 3. 客户端应立即用 latestProfile 重建，并再 GET /profile 拉全量（revision=8）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfigRepo } from '../assets/lib/core';
import type { ConfigData, Profile } from '../assets/lib/core';
import { createMockProfile } from '../assets/scripts/dev/mockProfile';
import { ApiClient } from '../assets/scripts/services/apiClient';
import type { HttpRequest, HttpResponse, PlatformAdapter, PlatformLoginResult } from '../assets/scripts/platform/types';

const BASE_TIME = 1_700_000_000_000;
const SERVER_OFFSET = 5_000;

function loadConfig(): ConfigData {
  const dir = join(process.cwd(), 'client', 'assets', 'resources', 'config');
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const content = read('content') as { contentVersion?: string };
  return {
    contentVersion: content.contentVersion ?? '',
    species: read('species'),
    elements: read('elements'),
    affinity: read('affinity'),
    skills: read('skills'),
    passives: read('passives'),
    traits: read('traits'),
    habitats: read('habitats'),
    foods: read('foods'),
    breeding: read('breeding'),
    stages: read('stages'),
    economy: read('economy'),
  } as ConfigData;
}

class FakePlatform implements PlatformAdapter {
  readonly kind = 'web' as const;
  readonly calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  private readonly revisionProfile: Profile;

  constructor(revisionProfile: Profile) {
    this.revisionProfile = revisionProfile;
  }

  login(): Promise<PlatformLoginResult> {
    return Promise.resolve({ kind: 'web', credential: 'verify-device' });
  }

  getStorage<T>(_key: string): Promise<T | null> {
    return Promise.resolve(null);
  }

  setStorage<T>(_key: string, value: T): Promise<void> {
    void value;
    return Promise.resolve();
  }

  now(): number {
    return BASE_TIME;
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    this.calls.push({ url: req.url, method: req.method, headers: req.headers });
    const serverTime = BASE_TIME + SERVER_OFFSET;
    if (req.url.endsWith('/auth/guest')) {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          data: {
            token: 'token-1',
            refreshToken: 'refresh-1',
            account: { id: 'acc-1', displayName: 'verify', region: 'cn', bindings: { guest: { deviceId: 'verify-device' } } },
            profileRevision: this.revisionProfile.revision,
            serverTime,
          },
        }),
      });
    }
    if (req.url.endsWith('/profile') && req.method === 'GET') {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({ ok: true, serverTime, data: { profile: this.revisionProfile, serverTime } }),
      });
    }
    if (req.url.endsWith('/habitat/feed')) {
      const latest = { ...this.revisionProfile, revision: 8 };
      return Promise.resolve({
        status: 409,
        body: JSON.stringify({
          ok: false,
          serverTime,
          error: {
            code: 'REVISION_CONFLICT',
            message: 'revision conflict',
            details: { latestProfile: latest, latestRevision: 8 },
          },
        }),
      });
    }
    return Promise.resolve({ status: 404, body: JSON.stringify({ ok: false, serverTime, error: { code: 'NOT_FOUND', message: 'not found' } }) });
  }
}

async function main(): Promise<void> {
  const cfg = createConfigRepo(loadConfig());
  const baseProfile = createMockProfile(BASE_TIME, cfg);
  const syncedProfile: Profile = { ...baseProfile, revision: 7 };
  const platform = new FakePlatform(syncedProfile);
  const seenRevisions: number[] = [];
  const offsets: number[] = [];

  const client = new ApiClient({
    baseUrl: 'http://fake',
    platform,
    getBaseRevision: () => 7,
    onProfile: (profile) => seenRevisions.push(profile.revision),
    onServerTime: (offset) => offsets.push(offset),
  });

  await client.login();
  if (Math.abs(client.serverTimeOffsetMs - SERVER_OFFSET) > 5) {
    throw new Error(`serverTime 偏移不对：${client.serverTimeOffsetMs}`);
  }
  const synced = await client.syncProfile();
  if (!synced || synced.revision !== 7) throw new Error('拉全量档失败');

  const petId = Object.keys(baseProfile.pets)[0];
  if (!petId) throw new Error('mock profile 没有宠物');
  const res = await client.feedPet({ petId, foodId: 'berry' });
  if (res.ok || res.error?.code !== 'REVISION_CONFLICT') {
    throw new Error(`期望 409 REVISION_CONFLICT，实际：${JSON.stringify(res)}`);
  }

  // 409 的 details 同步回调需要一帧（同步路径也应已写入）
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (!seenRevisions.includes(8)) {
    throw new Error(`没有用 latestProfile(revision=8) 重建：${seenRevisions.join(',')}`);
  }
  if (seenRevisions[seenRevisions.length - 1] !== 8) {
    throw new Error(`409 重建后又被旧档覆盖：${seenRevisions.join(',')}`);
  }

  const feedCall = platform.calls.find((call) => call.url.endsWith('/habitat/feed'));
  if (!feedCall) throw new Error('没有发出 /habitat/feed');
  if (feedCall.headers['Idempotency-Key'] === undefined) throw new Error('写操作缺 Idempotency-Key');
  if (feedCall.headers['X-Base-Revision'] !== '7') {
    throw new Error(`X-Base-Revision 不对：${feedCall.headers['X-Base-Revision']}`);
  }

  const profileCalls = platform.calls.filter((call) => call.url.endsWith('/profile'));
  if (profileCalls.length < 1) throw new Error('没有发过 GET /profile');

  console.log('PASS serverTime 偏移：', client.serverTimeOffsetMs, '（记录', offsets.join(','), '）');
  console.log('PASS 409 用 latestProfile 重建，profile revisions：', seenRevisions.join(','));
  console.log('PASS 写操作头：Idempotency-Key + X-Base-Revision=7');
}

void main().catch((error: unknown) => {
  console.error('FAIL', error);
  process.exit(1);
});
