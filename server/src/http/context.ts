/**
 * 请求上下文与依赖容器。
 *
 * 路由处理器只拿 `RequestContext` + 闭包里的 `ServerDeps`，不碰全局单例：
 * 测试可以直接构造内存依赖，替换时钟/存储。
 */
import type { IncomingMessage } from 'node:http';

import type { KeyedMutex, Semaphore } from '../concurrency.js';
import type { ServerConfig } from '../config.js';
import type { CoreAdapter } from '../domain/core-adapter.js';
import type { Logger } from '../logger.js';
import type { AuthService } from '../services/auth-service.js';
import type { IdempotencyService } from '../services/idempotency.js';
import type { ProfileService } from '../services/profile-service.js';
import type { Store } from '../storage/types.js';
import type { TokenSigner } from '../auth/token.js';
import type { Reply } from './reply.js';

export interface RequestContext {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  /** 请求开始时的服务器时间；整条链路只用一个值。 */
  now: number;
  requestId: string;
}

export interface ServerDeps {
  config: ServerConfig;
  store: Store;
  logger: Logger;
  /** 服务器权威时钟；测试注入假时钟，业务代码不允许直接 `Date.now()`。 */
  clock: () => number;
  tokens: TokenSigner;
  core: CoreAdapter;
  mutex: KeyedMutex;
  /** 异步 PvP 模拟限并发（TECH_DESIGN §16.1）；M1 尚未接线。 */
  pvpSemaphore: Semaphore;
  auth: AuthService;
  profiles: ProfileService;
  idempotency: IdempotencyService;
}

export type RouteHandler = (context: RequestContext) => Promise<Reply>;
