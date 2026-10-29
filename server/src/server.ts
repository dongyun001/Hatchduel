/**
 * 服务器装配：`createApp` 之上只管监听与关闭。
 *
 * `startServer(0)` 用随机端口，测试共用；不传依赖时使用内存存储 + 默认配置，
 * 与 contract-v1 的 `/health` 用例保持兼容。
 */
import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from './app.js';
import { DEFAULT_PORT, loadConfig } from './config.js';
import type { ServerConfig } from './config.js';
import { createDeps } from './deps.js';
import type { CoreAdapter } from './domain/core-adapter.js';
import type { ConfigRepo } from '@petbattle/core';
import type { ServerDeps } from './http/context.js';
import { silentLogger } from './logger.js';
import type { Logger } from './logger.js';
import { InMemoryStore } from './storage/memory.js';
import type { Store } from './storage/types.js';

export { DEFAULT_PORT };
export type { HealthPayload } from './app.js';

export interface StartOptions {
  config?: ServerConfig;
  store?: Store;
  logger?: Logger;
  clock?: () => number;
  core?: CoreAdapter;
  /** 配置仓库；缺省时 core 桥接降级为恒等推进。 */
  configRepo?: ConfigRepo;
}

export interface RunningServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

function defaultConfig(port: number): ServerConfig {
  const base = loadConfig(process.env);
  return {
    ...base,
    port,
    // 测试默认不连数据库：即使环境里残留 DATABASE_URL 也不误连。
    pg: { connectionString: undefined, maxPoolSize: base.pg.maxPoolSize },
  };
}

export function buildDeps(options: StartOptions, port: number): ServerDeps {
  return createDeps({
    config: options.config ?? defaultConfig(port),
    store: options.store ?? new InMemoryStore(),
    logger: options.logger ?? silentLogger,
    clock: options.clock,
    core: options.core,
    configRepo: options.configRepo,
  });
}

export function createServer(options: StartOptions = {}): Server {
  return createHttpServer(createApp(buildDeps(options, DEFAULT_PORT)));
}

/** 启动并解析实际端口（测试用 0 拿随机端口）。 */
export async function startServer(port = DEFAULT_PORT, options: StartOptions = {}): Promise<RunningServer> {
  const deps = buildDeps(options, port);
  const server = createHttpServer(createApp(deps));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, deps.config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  return {
    server,
    port: address?.port ?? port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
