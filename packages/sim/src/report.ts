/** 报告渲染：Markdown（写入 BALANCE.md 的自动段落）与控制台摘要。 */
import type {
  BalanceReport,
  BattleMetrics,
  BreedingGroup,
  EconomyCurve,
  SimCheck,
  StaticAnalysis,
} from './types.js';

export const SIM_BEGIN = '<!-- SIM:BEGIN 由 `pnpm sim --write` 覆盖本段 -->';
export const SIM_END = '<!-- SIM:END -->';

const CHECK_ICON: Record<SimCheck['level'], string> = {
  pass: '通过',
  warn: '注意',
  fail: '失败',
};

function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'NaN';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function table(headers: string[], rows: string[][]): string[] {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines;
}

function renderStatic(analysis: StaticAnalysis): string[] {
  const lines: string[] = [];
  lines.push('### 配置静态分析（配置口径）', '');
  lines.push(
    `内容版本 **${analysis.contentVersion}**；物种 ${analysis.counts.species} / 属性 ${analysis.counts.elements} / 主动技能 ${analysis.counts.skills} / 被动 ${analysis.counts.passives} / 特质 ${analysis.counts.traits} / 关卡 ${analysis.counts.stages}；图鉴组合 ${analysis.counts.codexCombos}。`,
    '',
  );

  lines.push(...table(
    ['检查', '级别', '说明'],
    analysis.checks.map((check) => [`${check.id}`, CHECK_ICON[check.level], check.detail]),
  ));
  lines.push('');

  lines.push('**关卡经验**', '');
  lines.push(
    ...table(
      ['关卡', 'order', '首通经验', '重复经验', '公式期望'],
      analysis.stageExp.map((stage) => [
        stage.stageId,
        String(stage.order),
        String(stage.firstClear),
        String(stage.repeat),
        `${stage.expectedFirst} / ${stage.expectedRepeat}`,
      ]),
    ),
  );
  lines.push('');

  const eco = analysis.economy;
  lines.push('**经济参数**', '');
  lines.push(
    ...table(
      ['项', '值'],
      [
        ['初始资源（金币/食物/基因尘）', `${eco.startingCoin} / ${eco.startingFood} / ${eco.startingGeneDust}`],
        ['首次繁殖成本（金币/食物）', `${eco.breedingCoin} / ${eco.breedingFood}`],
        ['满容量产出（金币/食物净额/基因尘每小时）', `${fmt(eco.coinPerHourAtCapacity)} / ${fmt(eco.foodNetPerHourAtCapacity)} / ${fmt(eco.geneDustPerHourAtCapacity)}`],
        ['五关首通合计（金币/基因尘）', `${eco.firstClearCoinTotal} / ${eco.firstClearDustTotal}`],
        ['栖息地 2 级成本（金币/基因尘）', `${eco.upgrade2Coin} / ${eco.upgrade2Dust}`],
        ['放生返还区间（基因尘）', `${eco.minReleaseDust}~${eco.maxReleaseDust}`],
      ],
    ),
  );
  lines.push('');

  if (analysis.notes.length > 0) {
    lines.push('**备注**', '');
    for (const note of analysis.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  return lines;
}

function battleVerdicts(battle: BattleMetrics): string[] {
  const out: string[] = [];
  if (battle.status !== 'ok') return out;
  if (battle.drawRate > 0.05) out.push(`平局率 ${fmt(battle.drawRate, 3)} 超过 5%，回合上限或控制效果可能过强。`);
  if (battle.avgTurns < 6) out.push(`平均 ${fmt(battle.avgTurns)} 回合，节奏偏快。`);
  if (battle.avgTurns > 18) out.push(`平均 ${fmt(battle.avgTurns)} 回合，战斗偏拖。`);
  if (battle.smallCastsPerUnitTurn > 0.5) {
    out.push(`小技能释放密度 ${fmt(battle.smallCastsPerUnitTurn, 3)}/单位回合，偏高（P-002 目标 < 0.5）。`);
  }
  if (battle.avgUltimateInterval > 0 && (battle.avgUltimateInterval < 2.5 || battle.avgUltimateInterval > 4.5)) {
    out.push(`大招间隔 ${fmt(battle.avgUltimateInterval)} 回合，偏离约 3 回合的目标。`);
  }
  if (battle.invalidNumbers > 0) out.push(`出现 ${battle.invalidNumbers} 个非有限数值（NaN/Infinity）。`);
  return out;
}

function renderBattle(battle: BattleMetrics): string[] {
  const lines: string[] = [];
  lines.push('### 批量 PVE 对局', '');
  if (battle.status !== 'ok') {
    lines.push(`未运行（core 尚未实现）：${battle.reason ?? '未知原因'}`, '');
    lines.push('> `BattleEngine` / `buildEnemyTeam` 由 A 实现后，`pnpm sim` 会自动跑出胜率、回合数、平局率与技能间隔。', '');
    return lines;
  }

  lines.push(
    `共 ${battle.battles} 场；胜 ${battle.wins} / 负 ${battle.losses} / 平 ${battle.draws}。`,
    '',
  );
  lines.push(
    ...table(
      ['指标', '值', '目标'],
      [
        ['胜率', fmt(battle.winRate, 3), '按关卡递减，见下表'],
        ['平局率', fmt(battle.drawRate, 3), '< 0.05'],
        ['平均回合数', fmt(battle.avgTurns), '6~18'],
        ['回合范围', `${battle.minTurns}~${battle.maxTurns}`, '≤ 30'],
        ['小技能/单位回合', fmt(battle.smallCastsPerUnitTurn, 3), '< 0.5（P-002）'],
        ['大招/单位回合', fmt(battle.ultimateCastsPerUnitTurn, 3), '—'],
        ['大招间隔', fmt(battle.avgUltimateInterval), '约 3 回合'],
        ['非有限数值', String(battle.invalidNumbers), '0'],
      ],
    ),
  );
  lines.push('');

  if (battle.perStage.length > 0) {
    lines.push('**分关结果**', '');
    lines.push(
      ...table(
        ['关卡', '场次', '胜率', '平局率', '平均回合'],
        battle.perStage.map((stage) => [
          stage.stageId,
          String(stage.battles),
          fmt(stage.winRate, 3),
          fmt(stage.drawRate, 3),
          fmt(stage.avgTurns),
        ]),
      ),
    );
    lines.push('');
  }

  const verdicts = battleVerdicts(battle);
  if (verdicts.length > 0) {
    lines.push('**结论**', '');
    for (const verdict of verdicts) lines.push(`- ${verdict}`);
    lines.push('');
  } else {
    lines.push('**结论**：各项指标在目标区间内（初版结论，待更多样本复核）。', '');
  }

  return lines;
}

function renderEconomy(curve: EconomyCurve): string[] {
  const lines: string[] = [];
  lines.push('### 7 天资源曲线（每 8 小时领取一次）', '');
  if (curve.status !== 'ok') {
    lines.push(`未运行（core 尚未实现）：${curve.reason ?? '未知原因'}`, '');
    return lines;
  }

  lines.push(
    ...table(
      ['天', '小时', '金币', '食物', '基因尘', '平均饥饿', '平均健康'],
      curve.dayEnd.map((point) => [
        String(point.hour / 24),
        String(point.hour),
        fmt(point.coin),
        fmt(point.food),
        fmt(point.geneDust),
        fmt(point.avgHunger),
        fmt(point.avgHealth),
      ]),
    ),
  );
  lines.push('');

  const first = curve.points[0];
  const last = curve.points[curve.points.length - 1];
  if (first && last) {
    lines.push(
      `第 ${curve.days} 天结束：金币 ${fmt(last.coin)}（+${fmt(last.coin - first.coin)}）、食物 ${fmt(last.food)}（${fmt(last.food - first.food)}）、基因尘 ${fmt(last.geneDust)}（+${fmt(last.geneDust - first.geneDust)}）。`,
      '',
    );
    if (last.food < first.food) {
      lines.push('- 食物净额为负：满容量时食物产出不足以覆盖消耗，需要调整 `upkeepPerPetPerHour` 或产出。', '');
    }
  }

  return lines;
}

function renderGroup(label: string, group: BreedingGroup): string[] {
  return table(
    [`${label}`, 'hp', 'atk', 'def', 'spd'],
    [
      ['基因均值', fmt(group.gene.mean.hp), fmt(group.gene.mean.atk), fmt(group.gene.mean.def), fmt(group.gene.mean.spd)],
      ['基因标准差', fmt(group.gene.std.hp), fmt(group.gene.std.atk), fmt(group.gene.std.def), fmt(group.gene.std.spd)],
      ['突变率', fmt(group.mutationRate, 3), '', '', ''],
      ['平均显性特质', fmt(group.avgExpressedTraits), '', '', ''],
    ],
  );
}

function renderBreeding(stats: BalanceReport['breeding']): string[] {
  const lines: string[] = [];
  lines.push('### 繁殖分布与近亲影响', '');
  if (stats.status !== 'ok') {
    lines.push(`未运行（core 尚未实现）：${stats.reason ?? '未知原因'}`, '');
    return lines;
  }

  lines.push(`样本 ${stats.samples}；近亲配对比例 ${fmt(stats.inbredRate, 3)}；非有限数值 ${stats.invalidNumbers}。`, '');
  lines.push('**总体子代**', '');
  lines.push(...renderGroup('总体', stats.overall));
  lines.push('');

  if (stats.inbred && stats.control) {
    lines.push('**近亲 vs 非近亲**', '');
    lines.push(
      ...table(
        ['分组', '样本', 'hp 均值', 'atk 均值', 'def 均值', 'spd 均值', '突变率'],
        [
          [
            '近亲',
            String(stats.inbred.samples),
            fmt(stats.inbred.gene.mean.hp),
            fmt(stats.inbred.gene.mean.atk),
            fmt(stats.inbred.gene.mean.def),
            fmt(stats.inbred.gene.mean.spd),
            fmt(stats.inbred.mutationRate, 3),
          ],
          [
            '对照',
            String(stats.control.samples),
            fmt(stats.control.gene.mean.hp),
            fmt(stats.control.gene.mean.atk),
            fmt(stats.control.gene.mean.def),
            fmt(stats.control.gene.mean.spd),
            fmt(stats.control.mutationRate, 3),
          ],
        ],
      ),
    );
    lines.push('');

    const geneDelta = stats.inbred.gene.mean.hp - stats.control.gene.mean.hp;
    if (geneDelta >= 0) {
      lines.push('- 近亲子代基因没有低于对照，检查 `inbreeding.genePenalty` 是否生效。', '');
    }
  }

  return lines;
}

export function renderSimSection(report: BalanceReport): string {
  const lines: string[] = [SIM_BEGIN, ''];
  lines.push(`> 自动生成于 ${report.generatedAt}；seed=${report.seed}；contentVersion=${report.contentVersion}。`, '');
  lines.push(...renderStatic(report.static));
  lines.push(...renderBattle(report.battle));
  lines.push(...renderEconomy(report.economy));
  lines.push(...renderBreeding(report.breeding));
  lines.push('**全局校验**', '');
  lines.push(
    `- 静态检查：通过 ${report.static.checks.filter((c) => c.level === 'pass').length} / 注意 ${report.static.checks.filter((c) => c.level === 'warn').length} / 失败 ${report.static.checks.filter((c) => c.level === 'fail').length}。`,
  );
  if (report.battle.status === 'ok') {
    lines.push(`- 战斗非有限数值：${report.battle.invalidNumbers}。`);
  }
  if (report.breeding.status === 'ok') {
    lines.push(`- 繁殖非有限数值：${report.breeding.invalidNumbers}。`);
  }
  lines.push('', SIM_END);
  return lines.join('\n');
}

export function applySimSection(document: string, section: string): string {
  const start = document.indexOf(SIM_BEGIN);
  const end = start >= 0 ? document.indexOf(SIM_END, start) : -1;
  if (start >= 0 && end > start) {
    return `${document.slice(0, start)}${section}${document.slice(end + SIM_END.length)}`;
  }
  return `${document.trimEnd()}\n\n${section}\n`;
}

export function renderConsoleSummary(report: BalanceReport): string {
  const staticFails = report.static.checks.filter((check) => check.level === 'fail').length;
  const staticWarns = report.static.checks.filter((check) => check.level === 'warn').length;
  const lines: string[] = [];
  lines.push(`PetBattle sim — contentVersion ${report.contentVersion} / seed ${report.seed}`);
  lines.push(`静态检查：${report.static.checks.length} 项，失败 ${staticFails}，注意 ${staticWarns}`);
  if (report.battle.status === 'ok') {
    lines.push(
      `战斗：${report.battle.battles} 场，胜率 ${fmt(report.battle.winRate, 3)}，平局 ${fmt(report.battle.drawRate, 3)}，平均 ${fmt(report.battle.avgTurns)} 回合，大招间隔 ${fmt(report.battle.avgUltimateInterval)}`,
    );
  } else {
    lines.push(`战斗：未运行（${report.battle.reason ?? 'unknown'}）`);
  }
  if (report.economy.status === 'ok') {
    lines.push(
      `经济：第 ${report.economy.days} 天金币 ${fmt(report.economy.totalCoin)} / 食物 ${fmt(report.economy.totalFood)} / 基因尘 ${fmt(report.economy.totalGeneDust)}`,
    );
  } else {
    lines.push(`经济：未运行（${report.economy.reason ?? 'unknown'}）`);
  }
  if (report.breeding.status === 'ok') {
    lines.push(
      `繁殖：${report.breeding.samples} 次，突变率 ${fmt(report.breeding.overall.mutationRate, 3)}，近亲比例 ${fmt(report.breeding.inbredRate, 3)}`,
    );
  } else {
    lines.push(`繁殖：未运行（${report.breeding.reason ?? 'unknown'}）`);
  }
  return lines.join('\n');
}
