import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolveFromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@petbattle/core': resolveFromRoot('./packages/core/src/index.ts'),
      '@petbattle/protocol': resolveFromRoot('./packages/protocol/src/index.ts'),
      '@petbattle/sim': resolveFromRoot('./packages/sim/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'server/test/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
