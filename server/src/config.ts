/**
 * 运行时配置：全部来自环境变量，集中解析与范围收敛。
 *
 * 2C2G 约束（TECH_DESIGN §16.1，PITFALLS P-022）：
 * - Postgres 连接池硬上限 20，默认 10；
 * - Node 堆由部署侧 `--max-old-space-size=1024` 限制（compose 已设置）；
 * - 异步 PvP 模拟并发默认 2，排队执行。
 */

export const DEFAULT_PORT = 3000;

/** 2C2G 下 Postgres 连接池硬上限；超过这个值的配置会被夹到上限。 */
export const MAX_PG_POOL_SIZE = 20;

export interface PgConfig {
  connectionString: string | undefined;
  maxPoolSize: number;
}

/** 存储选择：auto = 有 DATABASE_URL 用 Postgres，否则内存。 */
export type StoreKind = 'auto' | 'memory' | 'postgres';

/**
 * 异步 PvP 参数（CONTRACT §7.5 F-04）。
 *
 * M2 先放服务端常量 + 环境变量；M3 再迁 `config/data/pvp.json`（D）。
 * `initialRating` / Elo K 值 / 匹配窗口 / 排行榜上限是冻结口径，不走环境变量。
 */
export interface PvpSettings {
  seasonId: string;
  initialRating: number;
  kWin: number;
  kLoss: number;
  kDraw: number;
  dailyChallenges: number;
  snapshotTtlMs: number;
  replayTtlMs: number;
  /** 200 → 600 → 不限；取第一个非空窗口。 */
  matchWindows: readonly number[];
  leaderboardDefaultLimit: number;
  leaderboardMaxLimit: number;
  botsEnabled: boolean;
  botRating: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  store: StoreKind;
  /** HMAC 密钥；生产必须由环境注入。 */
  tokenSecret: string;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  /** 幂等结果保留时长；重放窗口。 */
  idempotencyTtlMs: number;
  /** PvE 战斗会话有效期（CONTRACT §7.4 E-01，默认 30 分钟）。 */
  battleSessionTtlMs: number;
  maxBodyBytes: number;
  /** core 还是契约桩时是否用恒等推进跑通契约；生产应设 `PETBATTLE_CORE_STUB=strict`。 */
  allowCoreStub: boolean;
  pvpSimulationConcurrency: number;
  pvp: PvpSettings;
  pg: PgConfig;
}

export const DEFAULT_TOKEN_SECRET = 'dev-only-insecure-secret';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DEFAULT_PVP_SETTINGS: PvpSettings = {
  seasonId: 's1',
  initialRating: 1000,
  kWin: 32,
  kLoss: 24,
  kDraw: 16,
  dailyChallenges: 10,
  snapshotTtlMs: DAY,
  replayTtlMs: 30 * DAY,
  matchWindows: [200, 600, Number.POSITIVE_INFINITY],
  leaderboardDefaultLimit: 20,
  leaderboardMaxLimit: 50,
  botsEnabled: true,
  botRating: 1000,
};

function readBool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
  return fallback;
}

function readNonEmptyString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.trim();
}

function loadPvpSettings(env: NodeJS.ProcessEnv): PvpSettings {
  return {
    seasonId: readNonEmptyString(env, 'PETBATTLE_PVP_SEASON_ID', DEFAULT_PVP_SETTINGS.seasonId),
    initialRating: DEFAULT_PVP_SETTINGS.initialRating,
    kWin: DEFAULT_PVP_SETTINGS.kWin,
    kLoss: DEFAULT_PVP_SETTINGS.kLoss,
    kDraw: DEFAULT_PVP_SETTINGS.kDraw,
    dailyChallenges: readInt(
      env,
      'PETBATTLE_PVP_DAILY_LIMIT',
      DEFAULT_PVP_SETTINGS.dailyChallenges,
    ),
    snapshotTtlMs: readInt(
      env,
      'PETBATTLE_PVP_SNAPSHOT_TTL_MS',
      DEFAULT_PVP_SETTINGS.snapshotTtlMs,
    ),
    replayTtlMs: readInt(env, 'PETBATTLE_PVP_REPLAY_TTL_MS', DEFAULT_PVP_SETTINGS.replayTtlMs),
    matchWindows: DEFAULT_PVP_SETTINGS.matchWindows,
    leaderboardDefaultLimit: DEFAULT_PVP_SETTINGS.leaderboardDefaultLimit,
    leaderboardMaxLimit: DEFAULT_PVP_SETTINGS.leaderboardMaxLimit,
    botsEnabled: readBool(env, 'PETBATTLE_PVP_BOTS', DEFAULT_PVP_SETTINGS.botsEnabled),
    botRating: DEFAULT_PVP_SETTINGS.botRating,
  };
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readStoreKind(env: NodeJS.ProcessEnv): StoreKind {
  const raw = env['PETBATTLE_STORE'];
  if (raw === 'memory' || raw === 'postgres') return raw;
  return 'auto';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const poolRaw = readInt(env, 'PG_POOL_MAX', 10);

  return {
    port: readInt(env, 'PORT', DEFAULT_PORT),
    host: env['HOST'] ?? '0.0.0.0',
    store: readStoreKind(env),
    tokenSecret: env['PETBATTLE_TOKEN_SECRET'] ?? DEFAULT_TOKEN_SECRET,
    accessTokenTtlMs: readInt(env, 'PETBATTLE_ACCESS_TTL_MS', 2 * HOUR),
    refreshTokenTtlMs: readInt(env, 'PETBATTLE_REFRESH_TTL_MS', 30 * DAY),
    idempotencyTtlMs: readInt(env, 'PETBATTLE_IDEMPOTENCY_TTL_MS', DAY),
    battleSessionTtlMs: readInt(env, 'PETBATTLE_BATTLE_TTL_MS', 30 * 60 * 1000),
    maxBodyBytes: readInt(env, 'PETBATTLE_MAX_BODY_BYTES', 64 * 1024),
    allowCoreStub: env['PETBATTLE_CORE_STUB'] !== 'strict',
    pvpSimulationConcurrency: readInt(env, 'PETBATTLE_PVP_CONCURRENCY', 2),
    pvp: loadPvpSettings(env),
    pg: {
      connectionString: env['DATABASE_URL'],
      maxPoolSize: Math.min(poolRaw, MAX_PG_POOL_SIZE),
    },
  };
}
