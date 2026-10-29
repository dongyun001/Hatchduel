/**
 * 结构化日志（ONLINE_DESIGN §12.4）：一行一个 JSON，带 `requestId` / `accountId` / `action`。
 * 测试用 `silentLogger`，避免污染输出。
 */

export type LogMeta = Record<string, unknown>;

export interface Logger {
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
}

const write = (level: 'info' | 'warn' | 'error', message: string, meta?: LogMeta): void => {
  const line = JSON.stringify({ level, message, at: Date.now(), ...meta });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function createConsoleLogger(): Logger {
  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
