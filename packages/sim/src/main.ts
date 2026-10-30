/**
 * `pnpm sim`
 *
 * 批量战斗（sim AI + core AI 两套，P-049） / 7 天资源曲线（只产出 + 真实路径） /
 * 5000 次繁殖，并把结果写入 `docs/BALANCE.md` 的自动段落（`--write`）。
 *
 * 用法：
 *   pnpm sim
 *   pnpm sim --battles=1000 --breed=5000 --days=7 --seed=20261029
 *   pnpm sim --ai=core --stage=stage_3 --no-battle
 *   pnpm sim --write --out=docs/BALANCE.md
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CoreNotImplementedError, createConfigRepo, type ConfigRepo } from '@petbattle/core';

import {
  analyzeConfig,
  applySimSection,
  loadConfig,
  renderConsoleSummary,
  renderSimSection,
  runBattleBatch,
  runBreedingBatch,
  runEconomyCurve,
  runPlayerPathCurve,
  unavailableBattle,
  unavailableBreeding,
  unavailableEconomy,
  unavailablePlayerPath,
  type AiMode,
  type BalanceReport,
  type BattleMetrics,
} from './index.js';

interface CliOptions {
  battles: number;
  breed: number;
  days: number;
  seed: number;
  stageId?: string;
  out: string;
  write: boolean;
  noBattle: boolean;
  ai: 'both' | AiMode;
  help: boolean;
}

const DEFAULT_OPTIONS: CliOptions = {
  battles: 1000,
  breed: 5000,
  days: 7,
  seed: 20261029,
  out: 'docs/BALANCE.md',
  write: false,
  noBattle: false,
  ai: 'both',
  help: false,
};

const USAGE = [
  'pnpm sim [options]',
  '',
  '  --battles=N     每关对局数（默认 1000）',
  '  --breed=N       繁殖样本数（默认 5000）',
  '  --days=N        经济曲线天数（默认 7）',
  '  --seed=N        随机种子（默认 20261029）',
  '  --stage=ID      只跑指定关卡（默认全部 5 关）',
  '  --no-battle     跳过战斗模拟',
  '  --ai=both|sim|core  决策来源（默认 both，P-049）',
  '  --write         把结果写入 docs/BALANCE.md 的自动段落',
  '  --out=PATH      输出文件（默认 docs/BALANCE.md）',
  '  --help          显示本帮助',
].join('\n');

class CliError extends Error {}

function parseInteger(raw: string | undefined, name: string, min: number): number {
  if (raw === undefined) throw new CliError(`${name} 需要一个整数`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new CliError(`${name} 需要 ≥ ${min} 的整数，实际 "${raw}"`);
  return value;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_OPTIONS };

  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      options.help = true;
      continue;
    }
    if (raw === '--write') {
      options.write = true;
      continue;
    }
    if (raw === '--no-battle') {
      options.noBattle = true;
      continue;
    }
    if (!raw.startsWith('--')) throw new CliError(`无法识别的参数 "${raw}"`);

    const body = raw.slice(2);
    const eq = body.indexOf('=');
    const key = eq >= 0 ? body.slice(0, eq) : body;
    const value = eq >= 0 ? body.slice(eq + 1) : undefined;

    switch (key) {
      case 'battles':
        options.battles = parseInteger(value, '--battles', 1);
        break;
      case 'breed':
        options.breed = parseInteger(value, '--breed', 1);
        break;
      case 'days':
        options.days = parseInteger(value, '--days', 1);
        break;
      case 'seed':
        options.seed = parseInteger(value, '--seed', 0);
        break;
      case 'stage':
        if (value === undefined || value.length === 0) throw new CliError('--stage 需要关卡 id');
        options.stageId = value;
        break;
      case 'out':
        if (value === undefined || value.length === 0) throw new CliError('--out 需要路径');
        options.out = value;
        break;
      case 'ai':
        if (value !== 'both' && value !== 'sim' && value !== 'core') {
          throw new CliError('--ai 需要 both / sim / core');
        }
        options.ai = value;
        break;
      default:
        throw new CliError(`未知选项 "--${key}"`);
    }
  }

  return options;
}

function describeError(error: unknown): string {
  if (error instanceof CoreNotImplementedError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function writeReportSection(path: string, report: BalanceReport): string {
  const absolute = resolve(process.cwd(), path);
  const existing = existsSync(absolute)
    ? readFileSync(absolute, 'utf8')
    : '# 数值与平衡（BALANCE）\n\n> 初版，待 sim。\n';
  const next = applySimSection(existing, renderSimSection(report));
  writeFileSync(absolute, next, 'utf8');
  return absolute;
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const data = loadConfig();
  const staticAnalysis = analyzeConfig(data);

  let cfg: ConfigRepo | null = null;
  let coreReason = 'core 尚未实现';
  try {
    cfg = createConfigRepo(data);
  } catch (error) {
    coreReason = describeError(error);
  }

  const aiModes: AiMode[] = options.ai === 'both' ? ['sim', 'core'] : [options.ai];
  const runBattle = (mode: AiMode): BattleMetrics => {
    if (options.noBattle) return unavailableBattle('--no-battle', mode);
    if (!aiModes.includes(mode)) return unavailableBattle(`--ai=${options.ai} 未启用`, mode);
    if (!cfg) return unavailableBattle(coreReason, mode);
    return runBattleBatch(cfg, data, {
      battlesPerStage: options.battles,
      seed: options.seed,
      stageId: options.stageId,
      ai: mode,
    });
  };
  const battle: Record<AiMode, BattleMetrics> = {
    sim: runBattle('sim'),
    core: runBattle('core'),
  };

  const economyPassive = cfg
    ? runEconomyCurve(cfg, data, options.days)
    : unavailableEconomy(coreReason, options.days);
  const playerPath = cfg
    ? runPlayerPathCurve(cfg, data, options.days)
    : unavailablePlayerPath(coreReason, options.days);

  const breeding = cfg
    ? runBreedingBatch(cfg, data, { samples: options.breed, seed: options.seed })
    : unavailableBreeding(coreReason);

  const report: BalanceReport = {
    generatedAt: new Date().toISOString(),
    contentVersion: data.contentVersion,
    seed: options.seed,
    static: staticAnalysis,
    battle,
    economyPassive,
    playerPath,
    breeding,
  };

  console.log(renderConsoleSummary(report));
  if (!cfg) {
    console.log('');
    console.log(`core 未就绪：${coreReason}`);
    console.log('静态分析仍会运行；批量战斗/经济/繁殖在 A 实现 core 后自动可用。');
  }

  if (options.write) {
    const written = writeReportSection(options.out, report);
    console.log('');
    console.log(`已写入 ${written}`);
  } else {
    console.log('');
    console.log('加 --write 可把完整报告写入 docs/BALANCE.md 的 SIM 段落。');
  }

  const failures = staticAnalysis.checks.filter((check) => check.level === 'fail').length;
  if (failures > 0) process.exitCode = 1;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === resolve(fileURLToPath(import.meta.url))) main();