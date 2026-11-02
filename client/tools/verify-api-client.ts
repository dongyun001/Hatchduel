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
    if (req.url.endsWith('/pvp/defense') && req.method === 'GET') {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          data: {
            defense: {
              petIds: [Object.keys(this.revisionProfile.pets)[0]],
              createdAt: BASE_TIME,
              expiresAt: BASE_TIME + 24 * 3600 * 1000,
              stale: false,
              contentVersion: 'test-content',
            },
            serverTime,
          },
        }),
      });
    }
    if (req.url.endsWith('/pvp/opponent')) {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          data: {
            opponent: {
              accountId: 'opp-1',
              displayName: '训练师·测试',
              rating: 1010,
              petCount: 2,
              speciesPreview: ['turtle', 'fish'],
              avgLevel: 5,
              isBot: false,
            },
            challengesRemaining: 9,
            dailyLimit: 10,
            seasonId: 's1',
            serverTime,
          },
        }),
      });
    }
    if (req.url.endsWith('/pvp/fight')) {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          revision: 9,
          data: {
            patch: {
              fromRevision: 8,
              toRevision: 9,
              at: BASE_TIME,
              lastEvaluatedAt: BASE_TIME,
              pvp: { defense: [], rating: 1016, seasonId: 's1' },
              stats: this.revisionProfile.stats,
            },
            revision: 9,
            serverTime,
            replayId: 'replay-1',
            result: 0,
            turns: 7,
            isBot: false,
            seasonId: 's1',
            ratingBefore: 1000,
            ratingAfter: 1016,
            challengesRemaining: 8,
            opponent: {
              accountId: 'opp-1',
              displayName: '训练师·测试',
              ratingBefore: 1010,
              ratingAfter: 994,
              isBot: false,
            },
          },
        }),
      });
    }
    if (req.url.includes('/pvp/replay/')) {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          data: {
            replay: {
              version: 'test-content',
              setup: { seed: 1, teams: [[], []] },
              seed: 1,
              commands: [],
              events: [],
              winner: null,
              turns: 0,
            },
            summary: {
              replayId: 'replay-1',
              seasonId: 's1',
              createdAt: BASE_TIME,
              attacker: { accountId: 'acc-1', displayName: '你', ratingBefore: 1000, ratingAfter: 1016 },
              defender: { accountId: 'opp-1', displayName: '训练师·测试', ratingBefore: 1010, ratingAfter: 994 },
              resultForAttacker: 0,
              isBot: false,
            },
            serverTime,
          },
        }),
      });
    }
    if (req.url.includes('/leaderboard')) {
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          ok: true,
          serverTime,
          data: { kind: 'rating', seasonId: 's1', entries: [], selfEligible: false, serverTime },
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

  // —— PvP / 排行榜路由（contract-v1.6）——
  const defense = await client.getPvpDefense();
  if (!defense.ok || !defense.data?.defense) throw new Error('GET /pvp/defense 失败');
  if (defense.data.defense.stale) throw new Error('新鲜防守快照不应 stale');

  const opponent = await client.getPvpOpponent();
  if (!opponent.ok || opponent.data?.opponent.accountId !== 'opp-1') throw new Error('GET /pvp/opponent 失败');
  if (opponent.data.challengesRemaining !== 9) throw new Error('challengesRemaining 不对');

  const fight = await client.fightPvp({ opponentAccountId: 'opp-1' }, 'fixed-fight-key');
  if (!fight.ok || fight.data?.replayId !== 'replay-1') throw new Error('POST /pvp/fight 失败');
  if (fight.data.ratingAfter !== 1016) throw new Error('fight rating 不对');

  const replay = await client.getPvpReplay('replay-1');
  if (!replay.ok || replay.data?.summary.replayId !== 'replay-1') throw new Error('GET /pvp/replay 失败');

  const board = await client.getLeaderboard({ kind: 'rating', limit: 20 });
  if (!board.ok || board.data?.selfEligible !== false) throw new Error('GET /leaderboard 失败');

  const fightCall = platform.calls.find((call) => call.url.endsWith('/pvp/fight'));
  if (!fightCall) throw new Error('没有发出 POST /pvp/fight');
  if (fightCall.headers['Idempotency-Key'] !== 'fixed-fight-key') {
    throw new Error(`fight 重试未复用 Idempotency-Key：${fightCall.headers['Idempotency-Key']}`);
  }
  if (fightCall.headers['X-Base-Revision'] === undefined) throw new Error('fight 写操作缺 X-Base-Revision');

  const replayCall = platform.calls.find((call) => call.url.includes('/pvp/replay/'));
  if (!replayCall || !replayCall.url.endsWith('/pvp/replay/replay-1')) {
    throw new Error(`replay 路径参数不对：${replayCall?.url ?? '(缺失)'}`);
  }
  const boardCall = platform.calls.find((call) => call.url.includes('/leaderboard'));
  if (!boardCall || !boardCall.url.includes('kind=rating') || !boardCall.url.includes('limit=20')) {
    throw new Error(`leaderboard query 不对：${boardCall?.url ?? '(缺失)'}`);
  }

  console.log('PASS serverTime 偏移：', client.serverTimeOffsetMs, '（记录', offsets.join(','), '）');
  console.log('PASS 409 用 latestProfile 重建，profile revisions：', seenRevisions.join(','));
  console.log('PASS 写操作头：Idempotency-Key + X-Base-Revision=7');
  console.log('PASS PvP 路由：/pvp/defense、/pvp/opponent、/pvp/fight、/pvp/replay/:id、/leaderboard');
}

void main().catch((error: unknown) => {
  console.error('FAIL', error);
  process.exit(1);
});
