import { describe, expect, it } from 'vitest';

import { createConfigRepo } from '@petbattle/core';

import { runBattleBatch } from '../src/battle.js';
import { runBreedingBatch } from '../src/breeding.js';
import { loadConfig } from '../src/config.js';
import { runEconomyCurve } from '../src/economy.js';
import { parseArgs } from '../src/main.js';
import { SIM_BEGIN, SIM_END, applySimSection } from '../src/report.js';
import { mulberry32, createRng } from '../src/rng.js';
import { analyzeConfig } from '../src/static-analysis.js';

describe('sim rng', () => {
  it('mulberry32 同种子逐次一致', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const first = [a(), a(), a(), a()];
    expect([b(), b(), b(), b()]).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('Rng.pick 空数组抛错，chance 与序列一致', () => {
    const rng = createRng(7);
    expect(() => rng.pick([])).toThrow();
    const pick = rng.pick(['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(pick);
    expect(typeof rng.chance(0.5)).toBe('boolean');
  });
});

describe('配置静态分析', () => {
  const config = loadConfig();
  const analysis = analyzeConfig(config);

  it('仓库配置没有 fail 级检查', () => {
    const failures = analysis.checks.filter((check) => check.level === 'fail');
    expect(failures).toEqual([]);
  });

  it('特质落在 15~20 条，且三档稀有度都有', () => {
    expect(analysis.counts.traits).toBeGreaterThanOrEqual(15);
    expect(analysis.counts.traits).toBeLessThanOrEqual(20);
    expect(analysis.traitsByRarity.common).toBeGreaterThan(0);
    expect(analysis.traitsByRarity.rare).toBeGreaterThan(0);
    expect(analysis.traitsByRarity.epic).toBeGreaterThan(0);
  });

  it('关卡经验满足 30+order×10 与 floor(首通/3)', () => {
    for (const stage of analysis.stageExp) {
      expect(stage.firstClear).toBe(30 + stage.order * 10);
      expect(stage.repeat).toBe(Math.floor(stage.firstClear / 3));
    }
  });

  it('图鉴组合为 25，经济无负净产出', () => {
    expect(analysis.counts.codexCombos).toBe(25);
    expect(analysis.economy.foodNetPerHourAtCapacity).toBeGreaterThan(0);
    expect(analysis.economy.minReleaseDust).toBeGreaterThanOrEqual(1);
  });
});

describe('CLI 参数', () => {
  it('默认值与覆盖', () => {
    const defaults = parseArgs([]);
    expect(defaults.battles).toBe(1000);
    expect(defaults.breed).toBe(1000);
    expect(defaults.days).toBe(7);

    const options = parseArgs(['--battles=50', '--stage=stage_2', '--write', '--no-battle']);
    expect(options.battles).toBe(50);
    expect(options.stageId).toBe('stage_2');
    expect(options.write).toBe(true);
    expect(options.noBattle).toBe(true);
  });

  it('非法参数抛错', () => {
    expect(() => parseArgs(['--battles=0'])).toThrow();
    expect(() => parseArgs(['--unknown'])).toThrow();
    expect(() => parseArgs(['positional'])).toThrow();
  });
});

describe('报告段落替换', () => {
  it('只替换首个 SIM 段，不误伤正文里的标记字样', () => {
    const doc = `# T\n\n正文提到 ${SIM_BEGIN} 但不在段落里。\n\n${SIM_BEGIN}\n\nold\n\n${SIM_END}\n`;
    const next = applySimSection(doc, `${SIM_BEGIN}\n\nnew\n\n${SIM_END}`);
    expect(next).toContain('new');
    expect(next).not.toContain('old');
    expect(next.startsWith('# T')).toBe(true);
  });
});

describe('sim 与 core 集成', () => {
  const config = loadConfig();
  const cfg = createConfigRepo(config);

  it('批量战斗有分关结果，且大招间隔可测', () => {
    const metrics = runBattleBatch(cfg, config, { battlesPerStage: 20, seed: 5 });
    expect(metrics.status).toBe('ok');
    expect(metrics.perStage.map((stage) => stage.stageId)).toEqual([
      'stage_1',
      'stage_2',
      'stage_3',
      'stage_4',
      'stage_5',
    ]);
    expect(metrics.battles).toBe(100);
    expect(metrics.drawRate).toBeLessThan(0.05);
    expect(metrics.invalidNumbers).toBe(0);
    expect(metrics.avgUltimateInterval).toBeGreaterThan(0);
  });

  it('近亲实验真的构造了 3 代内共同祖先', () => {
    const stats = runBreedingBatch(cfg, config, { samples: 30, seed: 99 });
    expect(stats.status).toBe('ok');
    expect(stats.ancestorVerified).toBe(true);
    expect(stats.randomInbredRate).toBe(0);
    expect(stats.inbredRate).toBe(1);
    expect(stats.controlInbredRate).toBe(0);
    expect(stats.inbred).not.toBeNull();
    expect(stats.control).not.toBeNull();
    expect(stats.inbred!.gene.mean.hp).toBeLessThan(stats.control!.gene.mean.hp);
    expect(stats.invalidNumbers).toBe(0);
  });

  it('7 天曲线无负值、无 NaN，离线封顶生效', () => {
    const curve = runEconomyCurve(cfg, config, 7);
    expect(curve.status).toBe('ok');
    expect(curve.hasNegativeValues).toBe(false);
    expect(curve.offlineCapVerified).toBe(true);
    expect(curve.offlineCapRatio).toBeLessThan(1.2);
    for (const point of curve.points) {
      expect(Number.isFinite(point.coin)).toBe(true);
      expect(Number.isFinite(point.food)).toBe(true);
      expect(Number.isFinite(point.geneDust)).toBe(true);
      expect(point.coin).toBeGreaterThanOrEqual(0);
    }
  });
});
