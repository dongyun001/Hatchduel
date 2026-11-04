#!/usr/bin/env node
/* global console, process */
/**
 * 固定构建参数（UI-04 / PITFALLS P-123）。
 *
 * 用法：
 *   node client/tools/build.mjs --platform=wechatgame --debug
 *   node client/tools/build.mjs --platform=web-mobile --release
 *   node client/tools/build.mjs --platform=wechatgame --postprocess-only=client/build/wechatgame
 *   node client/tools/build.mjs --platform=wechatgame --release --appid=wxXXXXXXXXXXXXXXXX
 *
 * 固定项：
 * - startScene 固定为 Boot 场景 uuid（P-118）。实测 Cocos 3.8.8 CLI 的 `startScene`
 *   只认 uuid；传 `db://assets/scenes/Boot.scene` 会被忽略并回退到资源顺序第一个场景。
 * - wechatgame 构建后强制 game.json.deviceOrientation=landscape；
 * - 复制 build-templates/wechatgame/project.config.json（AppID/urlCheck 单源）；
 *   可用 `--appid=` 覆盖模板里的 touristappid，上传正式号时无需手改产物；
 * - 校验产物 src/settings.json 的 launchScene 是 Boot，不一致直接退出 1；
 * - 构建前默认跑 sync-lib.mjs（--skip-sync 可跳过）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '..');
const repoRoot = resolve(clientRoot, '..');

const START_SCENE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function parseArgs(argv) {
  const options = {
    platform: '',
    debug: true,
    skipSync: false,
    skipPostprocess: false,
    postprocessOnly: '',
    creatorDir: process.env.COCOS_CREATOR_DIR ?? 'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8',
    buildRoot: join(clientRoot, 'build'),
    project: clientRoot,
    appid: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--platform=')) options.platform = arg.slice('--platform='.length);
    else if (arg === '--release') options.debug = false;
    else if (arg === '--debug') options.debug = true;
    else if (arg === '--skip-sync') options.skipSync = true;
    else if (arg === '--skip-postprocess') options.skipPostprocess = true;
    else if (arg.startsWith('--postprocess-only=')) options.postprocessOnly = arg.slice('--postprocess-only='.length);
    else if (arg.startsWith('--creator=')) options.creatorDir = arg.slice('--creator='.length);
    else if (arg.startsWith('--build-root=')) options.buildRoot = resolve(arg.slice('--build-root='.length));
    else if (arg.startsWith('--appid=')) options.appid = arg.slice('--appid='.length);
    else if (arg === '--help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`[build] 未知参数：${arg}`);
      process.exit(2);
    }
  }
  return options;
}

export function findLaunchScene(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'launchScene' && typeof item === 'string') return item;
    const found = findLaunchScene(item);
    if (found) return found;
  }
  return null;
}

export function sumSize(dir) {
  let total = 0;
  const walk = (path) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else total += info.size;
    }
  };
  if (existsSync(dir)) walk(dir);
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function resolveOutputDir(buildRoot, platform) {
  const direct = join(buildRoot, platform);
  if (existsSync(direct)) return direct;
  const nested = join(buildRoot, platform, platform);
  if (existsSync(nested)) return nested;
  return direct;
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function postprocessWechat(outDir, appid) {
  const templateDir = join(clientRoot, 'build-templates', 'wechatgame');
  const gameTemplate = join(templateDir, 'game.json');
  const projectTemplate = join(templateDir, 'project.config.json');

  const gamePath = join(outDir, 'game.json');
  const game = readJson(gamePath, existsSync(gameTemplate) ? readJson(gameTemplate, {}) : {});
  game.deviceOrientation = 'landscape';
  game.showStatusBar = false;
  writeFileSync(gamePath, `${JSON.stringify(game, null, 2)}\n`);

  if (existsSync(projectTemplate)) {
    const project = readJson(projectTemplate, {});
    project.appid = appid || project.appid || 'touristappid';
    project.projectname = project.projectname || 'PetBattle';
    project.setting = { ...(project.setting ?? {}), urlCheck: false };
    writeFileSync(join(outDir, 'project.config.json'), `${JSON.stringify(project, null, 2)}\n`);
  }

  const gameCheck = readJson(gamePath, {});
  if (gameCheck.deviceOrientation !== 'landscape') {
    throw new Error(`game.json.deviceOrientation=${gameCheck.deviceOrientation}，期望 landscape`);
  }
  const projectPath = join(outDir, 'project.config.json');
  if (existsSync(projectPath)) {
    const project = readJson(projectPath, {});
    if (project.setting?.urlCheck !== false) throw new Error('project.config.json setting.urlCheck 不为 false');
    if (!project.appid) throw new Error('project.config.json 缺少 appid');
    console.log(`[build] WeChat AppID=${project.appid} · urlCheck=false · orientation=landscape`);
  }
}

function verifyLaunchScene(outDir) {
  const candidates = [
    join(outDir, 'src', 'settings.json'),
    join(outDir, 'settings.json'),
  ];
  const settingsPath = candidates.find((file) => existsSync(file));
  if (!settingsPath) throw new Error(`找不到构建产物 settings.json（${outDir}）`);
  const settings = readJson(settingsPath, {});
  const launchScene = findLaunchScene(settings);
  if (!launchScene || !launchScene.includes('Boot.scene')) {
    throw new Error(`launchScene=${launchScene ?? '(缺失)'}，期望包含 Boot.scene（P-118）`);
  }
  console.log(`[build] launchScene=${launchScene}`);
}

function postprocess(platform, outDir, appid) {
  if (!existsSync(outDir)) throw new Error(`构建产物目录不存在：${outDir}`);
  if (platform === 'wechatgame') postprocessWechat(outDir, appid);
  verifyLaunchScene(outDir);
  console.log(`[build] 包体（未压缩）：${formatSize(sumSize(outDir))} · ${outDir}`);
}

function runSync() {
  console.log('[build] 同步 core/protocol → assets/lib');
  const result = spawnSync(process.execPath, [join(here, 'sync-lib.mjs')], { stdio: 'inherit', cwd: repoRoot });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function runCreator(options) {
  const exe = join(options.creatorDir, 'CocosCreator.exe');
  if (!existsSync(exe)) {
    console.error(`[build] 找不到 Cocos Creator：${exe}`);
    console.error('[build] 用 --creator=<安装目录> 或 COCOS_CREATOR_DIR 指定');
    process.exit(1);
  }
  const settings = [
    `platform=${options.platform}`,
    `debug=${options.debug}`,
    `startScene=${START_SCENE}`,
    `buildPath=${options.buildRoot}`,
    'md5Cache=false',
  ].join(';');
  console.log(`[build] ${exe}`);
  console.log(`[build] --build "${settings}"`);
  const result = spawnSync(exe, ['--project', options.project, '--build', settings], { stdio: 'inherit' });
  // Cocos CLI 成功退出码为 36，部分版本返回 0。
  if (result.status !== 36 && result.status !== 0) {
    console.error(`[build] Cocos 构建失败，退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.postprocessOnly) {
    const outDir = resolve(options.postprocessOnly);
    const platform = options.platform || (outDir.includes('wechatgame') ? 'wechatgame' : 'web-mobile');
    console.log(`[build] 仅后处理：${platform} · ${outDir}`);
    postprocess(platform, outDir, options.appid);
    return;
  }

  if (!options.platform) {
    console.error('[build] 必须指定 --platform=wechatgame|web-mobile');
    process.exit(2);
  }
  if (!options.skipSync) runSync();

  mkdirSync(options.buildRoot, { recursive: true });
  runCreator(options);

  if (!options.skipPostprocess) {
    const outDir = resolveOutputDir(options.buildRoot, options.platform);
    postprocess(options.platform, outDir, options.appid);
  }
}

try {
  main();
} catch (error) {
  console.error(`[build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
