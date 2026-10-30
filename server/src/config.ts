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
  pg: PgConfig;
}

export const DEFAULT_TOKEN_SECRET = 'dev-only-insecure-secret';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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
    pg: {
      connectionString: env['DATABASE_URL'],
      maxPoolSize: Math.min(poolRaw, MAX_PG_POOL_SIZE),
    },
  };
}
