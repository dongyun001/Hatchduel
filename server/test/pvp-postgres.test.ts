/**
 * Postgres 全链路（可选）：迁移 001~003、两账号 PvP、重启后持久化。
 *
 * 默认跳过；用独立测试库：
 *   PETBATTLE_TEST_DATABASE_URL=postgres://petbattle:petbattle@127.0.0.1:5433/petbattle \
 *     pnpm test -- server/test/pvp-postgres.test.ts
 *
 * 测试会 drop/create `petbattle_pvp_test`，不要指向生产库。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConfigRepo, Profile } from '@petbattle/core';

import { authHeaders, get, testConfig } from './helpers.js';
import { testConfigRepo } from './fixtures.js';
import { silentLogger } from '../src/logger.js';
import { startServer } from '../src/server.js';
import type { PvpHarness } from './pvp-helpers.js';
import {
  fight,
  fightOf,
  getDefense,
  getReplay,
  loginPvp,
  prepareFighter,
  profileOf,
  replayOf,
} from './pvp-helpers.js';
import { loadPgModule } from '../src/storage/pg-driver.js';
import type { PgPool } from '../src/storage/pg-driver.js';
import { PostgresStore } from '../src/storage/postgres.js';
import type { PvpDefenseRecord } from '../src/storage/types.js';

const BASE_URL = process.env['PETBATTLE_TEST_DATABASE_URL'];
const DB_NAME = 'petbattle_pvp_test';
const NOW = 1_700_000_000_000;

let adminPool: PgPool;
let store: PostgresStore;
let pool: PgPool;
let running: Awaited<ReturnType<typeof startServer>>;
let harness: PvpHarness;
let cfg: ConfigRepo;

function testDatabaseUrl(): string {
  const url = new URL(BASE_URL as string);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
}

function adminDatabaseUrl(): string {
  const url = new URL(BASE_URL as string);
  url.pathname = '/postgres';
  return url.toString();
}

async function openStore(): Promise<{ store: PostgresStore; pool: PgPool }> {
  const { Pool } = loadPgModule();
  const created = new Pool({ connectionString: testDatabaseUrl(), max: 5 });
  const createdStore = new PostgresStore(created);
  await createdStore.migrate();
  return { store: createdStore, pool: created };
}

async function startHarness(currentStore: PostgresStore): Promise<{
  running: Awaited<ReturnType<typeof startServer>>;
  harness: PvpHarness;
}> {
  const started = await startServer(0, {
    config: testConfig(),
    store: currentStore,
    logger: silentLogger,
    clock: () => NOW,
    configRepo: cfg,
  });
  return {
    running: started,
    harness: { baseUrl: `http://127.0.0.1:${started.port}`, store: currentStore },
  };
}

describe.skipIf(BASE_URL === undefined)('Postgres：PvP 迁移与持久化', () => {
  beforeAll(async () => {
    cfg = await testConfigRepo();
    const { Pool } = loadPgModule();
    adminPool = new Pool({ connectionString: adminDatabaseUrl(), max: 1 });
    await adminPool.query(`drop database if exists ${DB_NAME} with (force)`);
    await adminPool.query(`create database ${DB_NAME}`);

    ({ store, pool } = await openStore());
    ({ running, harness } = await startHarness(store));
  });

  afterAll(async () => {
    if (running !== undefined) await running.close();
    if (store !== undefined) await store.close();
    if (adminPool !== undefined) {
      await adminPool.query(`drop database if exists ${DB_NAME} with (force)`);
      await adminPool.end();
    }
  });

  it('迁移台账包含 001/002/003', async () => {
    const result = await pool.query<{ name: string }>(
      'select name from schema_migrations order by name',
    );
    expect(result.rows.map((row) => row.name)).toEqual([
      '001_init.sql',
      '002_battle_sessions.sql',
      '003_pvp.sql',
    ]);
  });

  it('两个账号完整流程；重启后快照/战报/评分仍在', async () => {
    const a = await loginPvp(harness, 'pg-pvp-a');
    const b = await loginPvp(harness, 'pg-pvp-b');
    await prepareFighter(harness, a, 'pg-a');
    await prepareFighter(harness, b, 'pg-b');

    const call = await fight(harness, a, b.accountId, 'pg-fight-1');
    expect(call.status).toBe(200);
    const data = fightOf(call);

    const attacker = await profileOf(harness, a);
    const defender = await profileOf(harness, b);
    expect(attacker.pvp.rating).toBe(data.ratingAfter);
    expect(defender.pvp.rating).toBe(data.opponent.ratingAfter);

    // 模拟进程重启：关闭 server/pool，再对新 pool 迁移并启动。
    await running.close();
    await store.close();
    ({ store, pool } = await openStore());
    ({ running, harness } = await startHarness(store));

    const afterRestartAttacker = await profileOf(harness, a);
    expect(afterRestartAttacker.pvp.rating).toBe(data.ratingAfter);

    const defense = await getDefense(harness, b);
    expect(defense.status).toBe(200);
    expect((defense.body.data as { defense?: { petIds: string[] } }).defense?.petIds.length).toBe(
      3,
    );

    const replay = await getReplay(harness, a, data.replayId);
    expect(replay.status).toBe(200);
    expect(replayOf(replay).summary.resultForAttacker).toBe(data.result);
    expect(replayOf(replay).replay.events?.length ?? 0).toBeGreaterThan(0);

    // 排行榜在 Postgres 侧也走 listProfiles/listAccounts。
    const leaderboard = await get(harness, '/leaderboard?kind=rating', authHeaders(a.token));
    expect(leaderboard.status).toBe(200);
    const board = leaderboard.body.data as {
      selfEligible: boolean;
      entries: unknown[];
      seasonId: string;
    };
    expect(board.seasonId).toBe('s1');
    expect(board.selfEligible).toBe(true);
    expect(board.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('防守快照与存档 CAS 原子：期望版本不符时两边都不写', async () => {
    const a = await loginPvp(harness, 'pg-atomic-a');
    await prepareFighter(harness, a, 'pg-atomic');

    const profile = await profileOf(harness, a);
    const snapshot = await store.getPvpDefense(a.accountId);
    if (snapshot === undefined) throw new Error('缺少防守快照');

    const forged: PvpDefenseRecord = { ...snapshot, createdAt: NOW + 1, expiresAt: NOW + 1000 };
    const next: Profile = { ...profile, revision: profile.revision + 1 };
    const saved = await store.savePvpDefenseWithProfile(forged, next, profile.revision + 5);
    expect(saved).toBe(false);

    const after = await store.getPvpDefense(a.accountId);
    expect(after?.createdAt).toBe(snapshot.createdAt);
    expect((await profileOf(harness, a)).revision).toBe(profile.revision);
  });

  it('每日次数在 Postgres 侧原子累加', async () => {
    const account = await loginPvp(harness, 'pg-daily');
    const first = await store.incrementDailyUsed(account.accountId, '2026-01-01');
    const second = await store.incrementDailyUsed(account.accountId, '2026-01-01');
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(await store.getDailyUsed(account.accountId, '2026-01-01')).toBe(2);
  });
});
