import { DEFAULT_PORT, startServer } from './server.js';

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

const running = await startServer(port);
console.log(`@petbattle/server listening on http://127.0.0.1:${running.port}`);
console.log(`  GET /health`);

const shutdown = (signal: string): void => {
  console.log(`\n${signal} received, closing server...`);
  void running.close().then(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
