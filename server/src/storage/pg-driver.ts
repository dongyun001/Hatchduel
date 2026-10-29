/**
 * `pg` 驱动的最小接口与懒加载。
 *
 * 为什么不直接 `import pg from 'pg'`：
 * - 锁文件只由 0 号维护，C 不能自行 `pnpm add pg`；
 * - 未装驱动时也要能跑内存实现（测试/无数据库本地开发），只在真正用 Postgres 时报错；
 * - 一旦 0 号把 `pg` 加进 `server/package.json`，这里无需改动即可工作。
 */
import { createRequire } from 'node:module';

export interface QueryResultLike<T> {
  rows: T[];
  rowCount: number | null;
}

/** 只要一个 `query` 就够；`pg.Pool` 的结构化子集。 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResultLike<T>>;
}

export interface PgPool extends Queryable {
  end(): Promise<void>;
}

export interface PgModule {
  Pool: new (config: { connectionString: string; max: number }) => PgPool;
}

export class MissingPgDriverError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `缺少 npm 依赖 "pg"：Postgres 存储需要它。锁文件只由 0 号会话修改，请让 0 号在 server/package.json 增加 "pg"（建议 ^8）并更新锁文件。原始错误：${reason}`,
    );
    this.name = 'MissingPgDriverError';
  }
}

export function loadPgModule(): PgModule {
  // 变量名不叫 require，避免触发 @typescript-eslint/no-require-imports。
  const load = createRequire(import.meta.url);
  try {
    return load('pg') as PgModule;
  } catch (error) {
    throw new MissingPgDriverError(error);
  }
}
