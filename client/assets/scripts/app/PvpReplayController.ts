import { _decorator, Component, type Label, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { loadPvpReplay } from '../services/pvpActions';
import { getConfigRepo } from '../services/config';
import type { ApiErrorCode, GetPvpReplayResponse } from '../../lib/protocol';
import type { BattleEvent, ConfigRepo } from '../../lib/core';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel, createTag } from '../ui/kit';
import { createEmptyState, createErrorState, createLoadingState } from '../ui/states';
import { makeLabel, place } from '../ui/nodes';
import { createTitle } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

type Phase = 'loading' | 'ready' | 'error' | 'empty';
type Speed = 1 | 2 | 4;

/**
 * M2-05 战报回放：只播服务端存储的 `events`（不重新模拟、不覆盖结果）。
 * 支持播放/暂停、1x/2x/4x、跳到结算；日志按事件顺序渲染。
 */
@ccclass('PvpReplayController')
export class PvpReplayController extends Component {
  private view: SceneView | null = null;
  private phase: Phase = 'loading';
  private data: GetPvpReplayResponse | null = null;
  private error: { code?: ApiErrorCode; message: string } | null = null;
  private cursor = 0;
  private playing = false;
  private speed: Speed = 1;
  private events: BattleEvent[] = [];
  private describe: (event: BattleEvent) => string = () => '';
  private logLabel: Label | null = null;
  private progressLabel: Label | null = null;

  start(): void {
    this.view = new SceneView(this, 'pvpreplay-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init().then(() => this.load());
  }

  onDestroy(): void {
    this.unschedule(this.tick);
    this.view?.dispose();
    this.view = null;
  }

  private async load(): Promise<void> {
    const replayId = appStore.getState().pvp.replayId;
    if (!replayId) {
      this.phase = 'empty';
      this.view?.refresh();
      return;
    }
    this.phase = 'loading';
    this.view?.refresh();
    const result = await loadPvpReplay(replayId);
    if (!result.ok || !result.data) {
      this.phase = 'error';
      this.error = { code: result.code, message: result.message };
      this.view?.refresh();
      return;
    }
    this.data = result.data;
    this.events = result.data.replay.events ?? [];
    this.describe = this.buildDescriber(result.data.replay.setup.teams, getConfigRepo());
    this.cursor = 0;
    this.playing = false;
    this.phase = 'ready';
    this.view?.refresh();
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '战报回放');
    place(title.node, 0, 440);

    const back = createButton(root, frames, {
      text: '返回结果',
      width: 260,
      height: 72,
      variant: 'secondary',
      onClick: () => gotoScene('pvpResult'),
    });
    place(back, -800, 440);

    if (this.phase === 'loading') {
      const loading = createLoadingState(root, frames, { text: '正在加载战报…' });
      place(loading, 0, 0);
      return;
    }

    if (this.phase === 'empty') {
      const empty = createEmptyState(root, frames, {
        text: '没有可播放的战报：先完成一场 PvP',
        actionText: '去匹配',
        onAction: () => gotoScene('pvpOpponent'),
      });
      place(empty, 0, 0);
      return;
    }

    if (this.phase === 'error') {
      const error = createErrorState(root, frames, {
        code: this.error?.code,
        message: this.error?.message ?? '战报加载失败',
        retryText: '重试',
        onRetry: () => void this.load(),
        onBack: () => gotoScene('pvpResult'),
      });
      place(error, 0, 0);
      return;
    }

    const data = this.data;
    if (!data) return;
    this.renderSummary(root, frames, data);
    this.renderLog(root, frames);

    const hint = makeLabel(root, '回放以服务端 events 为准；不重新模拟，不覆盖结算结果。', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(hint.node, 0, -430);
    void state;
  }

  private renderSummary(root: Node, frames: PlaceholderFrames, data: GetPvpReplayResponse): void {
    const summary = data.summary;
    const panel = createPanel(root, frames, 1500, 150, COLORS.panel);
    place(panel, 0, 300);

    const resultText = summary.resultForAttacker === 0 ? '攻方胜' : summary.resultForAttacker === 1 ? '防守方胜' : '平局';
    const result = makeLabel(panel, resultText, {
      fontSize: FONT_SIZE.heading,
      color: summary.resultForAttacker === 0 ? COLORS.good : summary.resultForAttacker === 1 ? COLORS.danger : COLORS.accent,
      align: 'left',
      width: 500,
    });
    place(result.node, -460, 30);

    const names = makeLabel(panel, `${summary.attacker.displayName} vs ${summary.defender.displayName}`, {
      fontSize: FONT_SIZE.body,
      color: COLORS.text,
      align: 'left',
      width: 900,
    });
    place(names.node, 90, 30);

    const ratings = makeLabel(
      panel,
      `${summary.attacker.ratingBefore}→${summary.attacker.ratingAfter}  ·  ${summary.defender.ratingBefore}→${summary.defender.ratingAfter}  ·  ${data.replay.turns} 回合`,
      { fontSize: FONT_SIZE.small, color: COLORS.textDim, align: 'left', width: 1100 },
    );
    place(ratings.node, 90, -22);

    if (summary.isBot) {
      const tag = createTag(panel, frames, 'BOT 不计榜', COLORS.accent, { fontSize: FONT_SIZE.small });
      place(tag, 590, 34);
    }

    const meta = makeLabel(panel, `${summary.replayId} · 赛季 ${summary.seasonId} · 版本 ${data.replay.version}`, {
      fontSize: 16,
      color: COLORS.textDim,
      align: 'left',
      width: 1300,
    });
    place(meta.node, 0, -66);
  }

  private renderLog(root: Node, frames: PlaceholderFrames): void {
    const panel = createPanel(root, frames, 1500, 340, COLORS.panelAlt);
    place(panel, 0, -60);

    this.logLabel = makeLabel(panel, this.logText(), {
      fontSize: 18,
      color: COLORS.text,
      align: 'left',
      width: 1420,
      height: 300,
      wrap: true,
    });
    place(this.logLabel.node, 0, 0);

    this.progressLabel = makeLabel(root, this.progressText(), {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(this.progressLabel.node, 0, -245);

    const play = createButton(root, frames, {
      text: this.playing ? '暂停' : '播放',
      width: 220,
      height: 76,
      variant: 'primary',
      onClick: () => this.togglePlay(),
    });
    place(play, -600, -320);

    ([1, 2, 4] as Speed[]).forEach((speed, index) => {
      const button = createButton(root, frames, {
        text: `${speed}x`,
        width: 110,
        height: 64,
        variant: this.speed === speed ? 'primary' : 'secondary',
        onClick: () => this.setSpeed(speed),
      });
      place(button, -400 + index * 130, -320);
    });

    const jump = createButton(root, frames, {
      text: '跳到结算',
      width: 260,
      height: 76,
      variant: 'secondary',
      onClick: () => this.jumpToEnd(),
    });
    place(jump, 80, -320);

    const home = createButton(root, frames, {
      text: '返回主页',
      width: 260,
      height: 76,
      variant: 'secondary',
      onClick: () => gotoScene('home'),
    });
    place(home, 420, -320);
  }

  private logText(): string {
    if (this.events.length === 0) return '该战报没有 events（旧战报或事件流缺失）。';
    const start = Math.max(0, this.cursor - 12);
    const lines = this.events.slice(start, this.cursor).map((event) => `${event.seq}. ${this.describe(event)}`);
    if (lines.length === 0) return '点击「播放」或「跳到结算」。';
    return lines.join('\n');
  }

  private progressText(): string {
    const total = this.events.length;
    const current = total === 0 ? 0 : Math.min(this.cursor, total);
    const turn = this.cursor > 0 ? this.events[Math.min(this.cursor, total) - 1]?.turn ?? 0 : 0;
    return `事件 ${current}/${total} · 回合 ${turn} · ${this.playing ? '播放中' : '已暂停'} · ${this.speed}x`;
  }

  private updateLabels(): void {
    if (this.logLabel && this.logLabel.isValid) this.logLabel.string = this.logText();
    if (this.progressLabel && this.progressLabel.isValid) this.progressLabel.string = this.progressText();
  }

  private togglePlay(): void {
    if (this.playing) {
      this.pause();
    } else {
      if (this.cursor >= this.events.length) this.cursor = 0;
      this.playing = true;
      this.unschedule(this.tick);
      this.schedule(this.tick, 0.45 / this.speed);
    }
    this.view?.refresh();
  }

  private pause(): void {
    this.playing = false;
    this.unschedule(this.tick);
  }

  private tick = (): void => {
    if (!this.playing) return;
    if (this.cursor >= this.events.length) {
      this.pause();
      this.updateLabels();
      return;
    }
    this.cursor += 1;
    if (this.cursor >= this.events.length) this.pause();
    this.updateLabels();
  };

  private setSpeed(speed: Speed): void {
    this.speed = speed;
    if (this.playing) {
      this.unschedule(this.tick);
      this.schedule(this.tick, 0.45 / this.speed);
    }
    this.view?.refresh();
  }

  private jumpToEnd(): void {
    this.pause();
    this.cursor = this.events.length;
    this.updateLabels();
    this.view?.refresh();
  }

  private buildDescriber(
    teams: readonly [readonly { uid: string; speciesId: string }[], readonly { uid: string; speciesId: string }[]],
    cfg: ConfigRepo,
  ): (event: BattleEvent) => string {
    const names = new Map<string, string>();
    teams.forEach((team, teamIndex) => {
      team.forEach((unit) => {
        let species = unit.speciesId;
        try {
          species = cfg.species(unit.speciesId).name;
        } catch {
          // 配置缺失时回退 id，保证回放不中断。
        }
        names.set(unit.uid, `${teamIndex === 0 ? '我' : '敌'}·${species}`);
      });
    });
    const unit = (uid: string): string => names.get(uid) ?? uid;
    const skill = (skillId: string): string => {
      try {
        return cfg.skill(skillId).name;
      } catch {
        return skillId;
      }
    };
    const winner = (value: 0 | 1 | null): string => (value === 0 ? '我方胜' : value === 1 ? '敌方胜' : '平局');

    return (event: BattleEvent): string => {
      switch (event.type) {
        case 'battleStart':
          return `战斗开始（${event.state.units.length} 单位）`;
        case 'turnStart':
          return `第 ${event.turn} 回合`;
        case 'cast':
          return `${unit(event.uid)} 使用 ${skill(event.skillId)}`;
        case 'hit': {
          const counter = event.countered !== 1 ? ` 克制×${event.countered}` : '';
          return `${unit(event.src)} → ${unit(event.dst)} 伤害 ${event.damage}${event.crit ? ' 暴击' : ''}${counter}`;
        }
        case 'miss':
          return `${unit(event.src)} → ${unit(event.dst)} 未命中`;
        case 'heal':
          return `${unit(event.src)} → ${unit(event.dst)} 回复 ${event.amount}`;
        case 'shield':
          return `${unit(event.dst)} 获得护盾 ${event.amount}`;
        case 'buffApply':
          return `${unit(event.dst)} 获得 ${event.buffId}（${event.kind}）`;
        case 'buffExpire':
          return `${unit(event.dst)} 的 ${event.buffId} 结束`;
        case 'dotTick':
          return `${unit(event.dst)} 持续伤害 ${event.damage}`;
        case 'energyTick':
          return `${unit(event.uid)} 精力 ${event.energy}`;
        case 'death':
          return `${unit(event.uid)} 倒下`;
        case 'battleEnd':
          return `战斗结束：${winner(event.winner)}（${event.turns} 回合）`;
        default:
          return '未知事件';
      }
    };
  }
}
