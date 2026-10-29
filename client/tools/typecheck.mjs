#!/usr/bin/env node
/* global console, process */
/**
 * 不打开 Cocos 编辑器做一次类型检查：
 * 用 Cocos 安装目录里的 `cc.d.ts` 提供 `cc` 模块声明，检查 assets/scripts + assets/lib。
 *
 * 环境变量：
 *   COCOS_CREATOR_DIR  覆盖 Cocos Creator 安装目录
 *   （默认 C:\ProgramData\cocos\editors\Creator\3.8.8）
 *
 * 生成的 tsconfig 写到 client/temp/（已 gitignore），不污染工程配置。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repoRoot = resolve(clientRoot, '..');

const creatorDir = process.env.COCOS_CREATOR_DIR ?? 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8';
const ccDts = join(creatorDir, 'resources', 'resources', '3d', 'engine', 'bin', '.declarations', 'cc.d.ts');

if (!existsSync(ccDts)) {
  console.error(`[typecheck] 找不到 cc.d.ts：${ccDts}`);
  console.error('[typecheck] 设置环境变量 COCOS_CREATOR_DIR 指向 Creator 安装目录');
  process.exit(1);
}

const tempDir = join(clientRoot, 'temp');
mkdirSync(tempDir, { recursive: true });
const configPath = join(tempDir, 'tsconfig.check.json');
const config = {
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ES2020', 'DOM'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    experimentalDecorators: true,
    useDefineForClassFields: false,
    resolveJsonModule: false,
    types: [],
    noUnusedLocals: false,
    noUnusedParameters: false,
  },
  files: [ccDts],
  include: ['../assets/scripts/**/*.ts', '../assets/lib/**/*.ts'],
};
writeFileSync(configPath, JSON.stringify(config, null, 2));

const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error(`[typecheck] 找不到根依赖里的 TypeScript：${tsc}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '--noEmit', '--project', configPath], {
  stdio: 'inherit',
  cwd: clientRoot,
});
process.exit(result.status ?? 1);
