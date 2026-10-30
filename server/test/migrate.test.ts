import { describe, expect, it } from 'vitest';

import { PostgresStore } from '../src/storage/postgres.js';
import type { Queryable } from '../src/storage/pg-driver.js';

/**
 * 迁移只执行一次：含 `drop/alter` 的迁移重跑会清数据（本批实测踩到）。
 * 这里用假 pool 记录 SQL，断言第二次 migrate 不再执行任何迁移脚本。
 */
function fakePool(): { pool: Queryable & { end(): Promise<void> }; migrations: string[] } {
  const applied = new Set<string>();
  const migrations: string[] = [];

  const pool = {
    async query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }> {
      if (text.includes('create table if not exists schema_migrations')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith('select 1 from schema_migrations')) {
        const name = String(values?.[0]);
        return applied.has(name)
          ? { rows: [{} as T], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.startsWith('insert into schema_migrations')) {
        applied.add(String(values?.[0]));
        return { rows: [], rowCount: 1 };
      }
      migrations.push(text);
      return { rows: [], rowCount: 0 };
    },
    async end(): Promise<void> {
      // no-op
    },
  };

  return { pool: pool as Queryable & { end(): Promise<void> }, migrations };
}

describe('PostgresStore.migrate', () => {
  it('按顺序执行迁移并记录版本；第二次启动不再重跑', async () => {
    const { pool, migrations } = fakePool();
    const store = new PostgresStore(pool);

    await store.migrate();
    expect(migrations).toHaveLength(2);
    expect(migrations[0]).toContain('create table if not exists accounts');
    expect(migrations[1]).toContain('battle_sessions');

    await store.migrate();
    expect(migrations).toHaveLength(2);
  });
});
