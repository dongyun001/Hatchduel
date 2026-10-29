/**
 * 进程入口：读环境变量 → 选存储（迁移）→ 起服务 → 优雅关闭。
 *
 * 生产形态由 `server/docker-compose.yml` 描述（Node + Postgres 同机，2C2G）。
 */
import { DEFAULT_TOKEN_SECRET, loadConfig } from './config.js';
import { loadConfigRepo } from './domain/config-provider.js';
import { createConsoleLogger } from './logger.js';
import { startServer } from './server.js';
import { createStore } from './storage/index.js';

const config = loadConfig();
const logger = createConsoleLogger();

if (config.tokenSecret === DEFAULT_TOKEN_SECRET) {
  logger.warn('PETBATTLE_TOKEN_SECRET 使用默认值：生产环境必须通过环境变量覆盖');
}

const configRepo = await loadConfigRepo({
  configDir: process.env['PETBATTLE_CONFIG_DIR'],
  logger,
});

// strict 模式下配置仓库不可用等于“所有领域写操作都会 501/假推进”，必须在启动时拒绝，
// 而不是等玩家点按钮才发现（PITFALLS P-043）。
if (!config.allowCoreStub && configRepo === undefined) {
  logger.error('PETBATTLE_CORE_STUB=strict 但配置仓库不可用，拒绝启动', {
    hint: '检查 packages/core/src/config/data 或设置 PETBATTLE_CONFIG_DIR',
  });
  process.exit(1);
}

let storeHandle;
try {
  storeHandle = await createStore(config, logger);
} catch (error) {
  logger.error('存储初始化失败', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

const running = await startServer(config.port, {
  config,
  store: storeHandle.store,
  logger,
  configRepo,
});
logger.info('服务已启动', {
  url: `http://127.0.0.1:${running.port}`,
  store: storeHandle.kind,
  protocolVersion: 'v1',
});

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('收到退出信号，正在关闭', { signal });
  void running
    .close()
    .then(() => storeHandle.store.close())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error('关闭失败', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
