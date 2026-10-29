/**
 * 存储工厂：`PETBATTLE_STORE=auto|memory|postgres`（默认 auto：有 DATABASE_URL 用 Postgres）。
 *
 * 启动顺序：先迁移再监听端口（ONLINE_DESIGN §12.3「先迁移后发版」）。
 * `memory` 只是开发/测试开关：重启丢档，不允许出现在生产环境。
 */
import type { ServerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { InMemoryStore } from './memory.js';
import { loadPgModule } from './pg-driver.js';
import { PostgresStore } from './postgres.js';
import type { Store } from './types.js';

export interface StoreHandle {
  store: Store;
  kind: 'memory' | 'postgres';
}

export async function createStore(config: ServerConfig, logger: Logger): Promise<StoreHandle> {
  const usePostgres =
    config.store === 'postgres' ||
    (config.store === 'auto' && config.pg.connectionString !== undefined && config.pg.connectionString !== '');

  if (!usePostgres) {
    if (config.store === 'postgres') {
      throw new Error('PETBATTLE_STORE=postgres 但未提供 DATABASE_URL');
    }
    logger.warn('使用内存存储（重启丢档，仅限测试/本地开发）', { store: config.store });
    return { store: new InMemoryStore(), kind: 'memory' };
  }

  const connectionString = config.pg.connectionString;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL 为空，无法连接 Postgres');
  }

  const { Pool } = loadPgModule();
  const pool = new Pool({ connectionString, max: config.pg.maxPoolSize });
  const store = new PostgresStore(pool);
  await store.migrate();
  logger.info('Postgres 存储已就绪（迁移已应用）', { maxPoolSize: config.pg.maxPoolSize });
  return { store, kind: 'postgres' };
}

export { InMemoryStore } from './memory.js';
export { PostgresStore } from './postgres.js';
export type { Store } from './types.js';
