#!/usr/bin/env node
/* global console, process */
/**
 * 把 @petbattle/core / @petbattle/protocol 的源码单向同步到 client/assets/lib/（PITFALLS P-103）。
 *
 * 为什么复制而不是 workspace 依赖：
 * - client/ 不在 pnpm workspace 里，Cocos 对 workspace 包的解析不稳定；
 * - 复制后改写成 Cocos 能解析的相对路径（去掉 .js 扩展名、替换包名为相对目录）。
 *
 * 方向是单向的：只允许 client 依赖 packages，不允许 packages 反向依赖 Cocos。
 *
 * 用法：
 *   node client/tools/sync-lib.mjs           # 生成/覆盖
 *   node client/tools/sync-lib.mjs --check   # 只校验是否与源一致（CI 用），不一致退出 1
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repoRoot = resolve(clientRoot, '..');
const libRoot = join(clientRoot, 'assets', 'lib');

const SOURCES = [
  { name: 'core', src: join(repoRoot, 'packages', 'core', 'src'), dest: join(libRoot, 'core') },
  { name: 'protocol', src: join(repoRoot, 'packages', 'protocol', 'src'), dest: join(libRoot, 'protocol') },
];

/** 配置数据（D 维护）复制到 resources，供运行时 resources.load 读取。 */
const CONFIG_SOURCE = {
  name: 'config',
  src: join(repoRoot, 'packages', 'core', 'src', 'config', 'data'),
  dest: join(clientRoot, 'assets', 'resources', 'config'),
};

const HEADER = [
  '// GENERATED FILE - DO NOT EDIT.',
  '// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；',
  '// 修改请改源包（所有者 A/0），然后重新运行同步脚本。',
  '// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。',
  '',
].join('\n');

/** 递归收集指定扩展名的文件（保持目录结构）。 */
function collectByExt(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectByExt(full, ext));
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** 递归收集 .ts 文件（保持目录结构）。 */
function collectTs(dir) {
  return collectByExt(dir, '.ts');
}

/** Cocos 用扩展名无关的模块解析：去掉相对 import 的 `.js` 后缀。 */
function stripJsExtension(code) {
  return code.replace(/(\bfrom\s+['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2$3');
}

/** 把 `@petbattle/core` 换成指向 assets/lib/core 的相对路径。 */
function rewritePackageSpecifiers(code, fromFile, sourceName) {
  const coreSpec = /(\bfrom\s+['"])@petbattle\/core(['"])/g;
  if (!coreSpec.test(code)) return code;
  if (sourceName === 'core') {
    throw new Error(`${fromFile}: core 不允许 import @petbattle/core（自引用）`);
  }
  const target = join(libRoot, 'core');
  let rel = relative(dirname(fromFile), target).split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return code.replace(coreSpec, `$1${rel}$2`);
}

/**
 * Cocos 构建的 loose spread 会把 `[...new Set(x)]` 编译成 `[].concat(new Set(x))`，
 * 结果是 `[Set]`（见 PITFALLS P-116）。客户端副本统一改成语义等价的 `Array.from(new Set(x))`。
 */
function rewriteSetSpread(code) {
  return code.replace(/\[\.\.\.new Set\(([^()]*)\)\]/g, 'Array.from(new Set($1))');
}

function transform(sourceFile, sourceName, destFile) {
  let code = readFileSync(sourceFile, 'utf8');
  code = stripJsExtension(code);
  code = rewritePackageSpecifiers(code, destFile, sourceName);
  code = rewriteSetSpread(code);
  return `${HEADER}${code}`;
}

function syncSource(source, checkOnly, problems) {
  const expected = new Map();
  for (const file of collectTs(source.src)) {
    const rel = relative(source.src, file).split(sep).join('/');
    const dest = join(source.dest, rel);
    expected.set(rel, { dest, content: transform(file, source.name, dest) });
  }

  if (checkOnly) {
    for (const [rel, item] of expected) {
      if (!existsSync(item.dest) || readFileSync(item.dest, 'utf8') !== item.content) {
        problems.push(`${source.name}/${rel}`);
      }
    }
    if (existsSync(source.dest)) {
      for (const file of collectTs(source.dest)) {
        const rel = relative(source.dest, file).split(sep).join('/');
        if (!expected.has(rel)) problems.push(`${source.name}/${rel}（源已删除）`);
      }
    }
    return;
  }

  mkdirSync(source.dest, { recursive: true });
  for (const item of expected.values()) {
    mkdirSync(dirname(item.dest), { recursive: true });
    writeFileSync(item.dest, item.content, 'utf8');
  }
  // 只清理源里已删除的 .ts；保留 Cocos 生成的 .meta，避免每次同步都换 uuid。
  for (const file of collectTs(source.dest)) {
    const rel = relative(source.dest, file).split(sep).join('/');
    if (!expected.has(rel)) rmSync(file, { force: true });
  }
}

function syncConfigData(checkOnly, problems) {
  const expected = new Map();
  for (const file of collectByExt(CONFIG_SOURCE.src, '.json')) {
    const rel = relative(CONFIG_SOURCE.src, file).split(sep).join('/');
    expected.set(rel, { dest: join(CONFIG_SOURCE.dest, rel), content: readFileSync(file, 'utf8') });
  }

  if (checkOnly) {
    for (const [rel, item] of expected) {
      if (!existsSync(item.dest) || readFileSync(item.dest, 'utf8') !== item.content) {
        problems.push(`${CONFIG_SOURCE.name}/${rel}`);
      }
    }
    if (existsSync(CONFIG_SOURCE.dest)) {
      for (const file of collectByExt(CONFIG_SOURCE.dest, '.json')) {
        const rel = relative(CONFIG_SOURCE.dest, file).split(sep).join('/');
        if (!expected.has(rel)) problems.push(`${CONFIG_SOURCE.name}/${rel}（源已删除）`);
      }
    }
    return;
  }

  mkdirSync(CONFIG_SOURCE.dest, { recursive: true });
  for (const item of expected.values()) {
    mkdirSync(dirname(item.dest), { recursive: true });
    writeFileSync(item.dest, item.content, 'utf8');
  }
  for (const file of collectByExt(CONFIG_SOURCE.dest, '.json')) {
    const rel = relative(CONFIG_SOURCE.dest, file).split(sep).join('/');
    if (!expected.has(rel)) rmSync(file, { force: true });
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const problems = [];

  for (const source of SOURCES) {
    if (!existsSync(source.src) || !statSync(source.src).isDirectory()) {
      console.error(`[sync-lib] 缺少源目录：${source.src}`);
      process.exit(1);
    }
    syncSource(source, checkOnly, problems);
  }

  if (!existsSync(CONFIG_SOURCE.src) || !statSync(CONFIG_SOURCE.src).isDirectory()) {
    console.error(`[sync-lib] 缺少配置数据目录：${CONFIG_SOURCE.src}`);
    process.exit(1);
  }
  syncConfigData(checkOnly, problems);

  if (checkOnly) {
    if (problems.length > 0) {
      console.error('[sync-lib] assets/lib 或 assets/resources/config 与源包不一致，请运行 node client/tools/sync-lib.mjs');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log('[sync-lib] assets/lib 与 assets/resources/config 已是最新');
    return;
  }

  console.log('[sync-lib] 已同步 core/protocol 到 assets/lib，配置数据到 assets/resources/config');
}

main();
