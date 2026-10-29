/**
 * 依赖组装：把配置、存储、token、core 桥接、服务一次性装配好。
 * 测试可注入内存存储、假时钟与静默日志；生产由 `main.ts` 传入 Postgres 存储。
 */
import { createTokenSigner } from './auth/token.js';
import { KeyedMutex, Semaphore } from './concurrency.js';
import type { ServerConfig } from './config.js';
import { createCoreAdapter } from './domain/core-adapter.js';
import type { CoreAdapter } from './domain/core-adapter.js';
import type { ConfigRepo } from '@petbattle/core';
import type { ServerDeps } from './http/context.js';
import { createConsoleLogger } from './logger.js';
import type { Logger } from './logger.js';
import { AuthService } from './services/auth-service.js';
import { IdempotencyService } from './services/idempotency.js';
import { ProfileService } from './services/profile-service.js';
import type { Store } from './storage/types.js';

export interface CreateDepsOptions {
  config: ServerConfig;
  store: Store;
  logger?: Logger;
  clock?: () => number;
  core?: CoreAdapter;
  /** 配置仓库；缺省时 core 桥接降级为恒等推进。 */
  configRepo?: ConfigRepo;
}

export function createDeps(options: CreateDepsOptions): ServerDeps {
  const logger = options.logger ?? createConsoleLogger();
  const clock = options.clock ?? Date.now;
  const mutex = new KeyedMutex();
  const tokens = createTokenSigner(options.config.tokenSecret);
  const core =
    options.core ??
    createCoreAdapter({
      allowStub: options.config.allowCoreStub,
      logger,
      configRepo: options.configRepo,
    });

  return {
    config: options.config,
    store: options.store,
    logger,
    tokens,
    core,
    mutex,
    pvpSemaphore: new Semaphore(options.config.pvpSimulationConcurrency),
    clock,
    auth: new AuthService({
      store: options.store,
      tokens,
      mutex,
      accessTokenTtlMs: options.config.accessTokenTtlMs,
      refreshTokenTtlMs: options.config.refreshTokenTtlMs,
    }),
    profiles: new ProfileService({ store: options.store, core, mutex, logger }),
    idempotency: new IdempotencyService(options.store, options.config.idempotencyTtlMs, mutex),
  };
}
