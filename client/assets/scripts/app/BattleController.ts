import { _decorator, Component, Node } from 'cc';
import { BattleEngine } from '../../lib/core';
import type { BattleEvent, BattleState, BattleUnit, Command, StageConfig } from '../../lib/core';
import { appStore } from './store';
import type { AppState, BattleSessionState } from './store';
import { gotoScene } from './navigation';
import { getConfigRepo } from '../services/config';
import { nowMs } from '../services/bootstrap';
import { claimBattle, describeRewards, winnerText } from '../services/battleActions';
import { errorMessage } from '../services/errors';
import { COLORS, DESIGN, FONT_SIZE, SPRITE_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makePanel, makeSprite, paint, place } from '../ui/nodes';
import { createTitle, elementTint, speciesName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

const CARD_W = 500;
const CARD_H = 150;
const PLAYER_X = -620;
const ENEMY_X = 620;
const CARD_YS = [240, 70, -100];
const SELECTED_TINT = '#2f5a70';
const ACTOR_TINT = '#3d3a22';
const DEAD_TINT = '#141e26';

interface SettlementState {
  claiming: boolean;
  claimed: boolean;
  message: string;
  rewardsText: string;
  error: string | null;
  restart: boolean;
}

/**
 * Battle：用 core BattleEngine 本地演出 PvE，按玩家选择收集有序指令；
 * 自动战斗调用 `engine.autoCommand`。结束时把完整 commands 交给 claim（服务端重放/离线结算）。
 */
@ccclass('BattleController')
export class BattleController extends Component {
  private view: SceneView | null = null;
  private engine: BattleEngine | null = null;
  private session: BattleSessionState | null = null;
  private stage: StageConfig | null = null;
  private commands: Command[] = [];
  private logs: string[] = [];
  private selectedTargetUid: string | null = null;
  private settlement: SettlementState | null = null;

  start(): void {
    const session = appStore.getState().battle;
    if (session) {
      try {
        const cfg = getConfigRepo();
        this.session = session;
        this.stage = cfg.stage(session.stageId);
        this.engine = BattleEngine.create(session.setup, cfg);
        this.logs = this.engine.state.log.map((event) => this.eventText(event)).filter(Boolean).slice(-14);
        if (this.logs.length === 0) this.logs.push('—— 回合 1 ——');
        this.ensureTarget(this.engine.state);
        this.runEnemyTurns();
        this.checkFinished();
      } catch (error) {
        appStore.setToast(`战斗初始化失败：${errorMessage(error)}`);
        this.engine = null;
      }
    }

    this.view = new SceneView(this, 'battle-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  // —— 指令推进 ——

  private submit(cmd: Command): void {
    const engine = this.engine;
    if (!engine || engine.state.phase !== 'ongoing') return;
    try {
      this.commands.push(cmd);
      this.appendEvents(engine.submit(cmd));
      this.runEnemyTurns();
      this.checkFinished();
    } catch (error) {
      this.view?.showToast(`指令失败：${errorMessage(error)}`);
    }
    this.view?.refresh();
  }

  private runEnemyTurns(): void {
    const engine = this.engine;
    if (!engine) return;
    let guard = 0;
    while (engine.state.phase === 'ongoing' && guard < 400) {
      guard += 1;
      const actor = engine.state.order[engine.state.cursor];
      const unit = engine.state.units.find((item) => item.uid === actor);
      if (!unit || unit.team === 0) break;
      try {
        const cmd = engine.autoCommand(actor);
        this.commands.push(cmd);
        this.appendEvents(engine.submit(cmd));
      } catch (error) {
        this.logs.push(`敌方行动异常：${errorMessage(error)}`);
        break;
      }
    }
  }

  private runAuto(): void {
    const engine = this.engine;
    if (!engine || engine.state.phase !== 'ongoing') return;
    let guard = 0;
    while (engine.state.phase === 'ongoing' && guard < 400) {
      guard += 1;
      try {
        const actor = engine.state.order[engine.state.cursor];
        const cmd = engine.autoCommand(actor);
        this.commands.push(cmd);
        this.appendEvents(engine.submit(cmd));
      } catch (error) {
        this.logs.push(`自动战斗异常：${errorMessage(error)}`);
        break;
      }
    }
    this.checkFinished();
    this.view?.refresh();
  }

  private checkFinished(): void {
    const engine = this.engine;
    if (!engine || engine.state.phase !== 'finished' || this.settlement) return;
    this.settlement = {
      claiming: false,
      claimed: false,
      message: winnerText(engine.state.winner),
      rewardsText: '',
      error: null,
      restart: false,
    };
  }

  private appendEvents(events: readonly BattleEvent[]): void {
    for (const event of events) {
      const text = this.eventText(event);
      if (text) this.logs.push(text);
    }
    this.logs = this.logs.slice(-14);
  }

  private eventText(event: BattleEvent): string {
    const nameOf = (uid: string): string => {
      const unit = this.engine?.state.units.find((item) => item.uid === uid);
      if (!unit) return uid;
      return `${unit.team === 0 ? '我方 ' : '敌方 '}${speciesName(unit.speciesId)}`;
    };
    switch (event.type) {
      case 'turnStart':
        return `—— 回合 ${event.turn} ——`;
      case 'cast':
        return `${nameOf(event.uid)} 使用 ${this.skillName(event.skillId)}`;
      case 'hit':
        return `${nameOf(event.src)} → ${nameOf(event.dst)} ${event.damage}${event.crit ? '（暴击）' : ''}`;
      case 'miss':
        return `${nameOf(event.src)} 的攻击被 ${nameOf(event.dst)} 闪避`;
      case 'heal':
        return `${nameOf(event.src)} 治疗 ${nameOf(event.dst)} +${event.amount}`;
      case 'shield':
        return `${nameOf(event.dst)} 获得护盾 ${event.amount}`;
      case 'buffApply':
        return `${nameOf(event.dst)} 获得 ${event.kind}（${event.remainingTurns} 回合）`;
      case 'buffExpire':
        return `${nameOf(event.dst)} 的 ${event.buffId} 结束`;
      case 'dotTick':
        return `${nameOf(event.dst)} 受到持续伤害 ${event.damage}`;
      case 'death':
        return `${nameOf(event.uid)} 倒下`;
      case 'battleEnd':
        return `战斗结束：${winnerText(event.winner)}（${event.turns} 回合）`;
      default:
        return '';
    }
  }

  private skillName(skillId: string): string {
    try {
      return getConfigRepo().skill(skillId).name;
    } catch {
      return skillId;
    }
  }

  // —— 渲染 ——

  private renderScene(root: Node, frames: PlaceholderFrames, _state: Readonly<AppState>): void {
    const engine = this.engine;
    const session = this.session;
    if (!engine || !session || !this.stage) {
      const title = createTitle(root, '战斗');
      place(title.node, 0, 490);
      const empty = makeLabel(root, '没有进行中的战斗', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      const back = makeButton(root, '返回关卡', 360, 84, frames.white, () => gotoScene('stageSelect'));
      place(back, 0, -80);
      return;
    }

    const battle = engine.state;
    this.ensureTarget(battle);

    const title = createTitle(root, `${this.stage.name} · 战斗`);
    place(title.node, 0, 490);
    const turn = makeLabel(
      root,
      `回合 ${battle.turn} / 30 · ${battle.phase === 'finished' ? '已结束' : '进行中'} · ${session.mode === 'server' ? '服务端会话' : '离线演示'}`,
      { fontSize: FONT_SIZE.small, color: COLORS.textDim },
    );
    place(turn.node, 0, 448);

    const byTeam = (team: 0 | 1): BattleUnit[] =>
      battle.units.filter((unit) => unit.team === team).sort((a, b) => a.slot - b.slot);
    byTeam(0).forEach((unit, index) => this.renderUnit(root, frames, unit, PLAYER_X, CARD_YS[index] ?? -250, battle));
    byTeam(1).forEach((unit, index) => this.renderUnit(root, frames, unit, ENEMY_X, CARD_YS[index] ?? -250, battle));

    this.renderLog(root, frames, battle);

    const expired =
      session.expiresAt !== null && battle.phase === 'ongoing' && nowMs() > session.expiresAt;
    if (expired) {
      this.renderOverlay(root, frames, '战斗已过期', '服务端会话超过 30 分钟，请重开。', true);
      return;
    }

    if (battle.phase === 'finished') {
      this.renderResult(root, frames, battle);
      return;
    }

    this.renderCommands(root, frames, battle);
  }

  private renderUnit(
    root: Node,
    frames: PlaceholderFrames,
    unit: BattleUnit,
    x: number,
    y: number,
    battle: BattleState,
  ): void {
    const current = battle.order[battle.cursor] === unit.uid && battle.phase === 'ongoing';
    const selected = unit.team === 1 && unit.uid === this.selectedTargetUid;
    const tint = !unit.alive ? DEAD_TINT : selected ? SELECTED_TINT : current ? ACTOR_TINT : COLORS.panel;
    const card = makePanel(root, CARD_W, CARD_H);
    paint(card, frames.white, tint);
    place(card, x, y);

    if (unit.team === 1 && unit.alive && battle.phase === 'ongoing') {
      card.on(Node.EventType.TOUCH_END, () => {
        this.selectedTargetUid = unit.uid;
        this.view?.refresh();
      });
    }

    const icon = makeSprite(
      card,
      this.unitFrame(unit, frames),
      SPRITE_SIZE.icon32 * DESIGN.pixelScale,
      SPRITE_SIZE.icon32 * DESIGN.pixelScale,
      unit.alive ? elementTint(unit.elementId) : '#202a33',
    );
    place(icon.node, -190, 0);

    const name = makeLabel(card, `${speciesName(unit.speciesId)} Lv.${unit.level}`, {
      fontSize: FONT_SIZE.body,
      color: unit.alive ? COLORS.text : '#5a6b78',
      align: 'left',
      width: 280,
    });
    place(name.node, -50, 38);

    const sub = makeLabel(card, `${unit.team === 0 ? '我方' : '敌方'} · ${unit.uid}${current ? ' · 行动中' : ''}`, {
      fontSize: 14,
      color: current ? COLORS.accent : COLORS.textDim,
      align: 'left',
      width: 280,
    });
    place(sub.node, -50, 14);

    const barWidth = 280;
    const bar = makePanel(card, barWidth, 18);
    paint(bar, frames.white, '#0a1015');
    place(bar, -20, -24);
    const ratio = unit.maxHp > 0 ? Math.max(0, Math.min(1, unit.hp / unit.maxHp)) : 0;
    const fillWidth = Math.round(barWidth * ratio);
    if (fillWidth > 0) {
      const fill = makePanel(card, fillWidth, 18);
      paint(fill, frames.white, ratio > 0.5 ? COLORS.good : ratio > 0.25 ? COLORS.accent : COLORS.danger);
      place(fill, -20 - (barWidth - fillWidth) / 2, -24);
    }

    const hp = makeLabel(card, unit.alive ? `${Math.max(0, unit.hp)} / ${unit.maxHp}` : '倒下', {
      fontSize: 14,
      color: COLORS.textDim,
      align: 'left',
      width: 200,
    });
    place(hp.node, -120, -52);

    const energy = makeLabel(card, `能量 ${unit.energy}`, {
      fontSize: 14,
      color: unit.energy >= 70 ? COLORS.accent : COLORS.textDim,
      align: 'right',
      width: 140,
    });
    place(energy.node, 160, -24);
  }

  private renderLog(root: Node, frames: PlaceholderFrames, battle: BattleState): void {
    const panel = makePanel(root, 460, 520);
    paint(panel, frames.white, COLORS.panel);
    place(panel, 0, 60);
    const title = makeLabel(panel, '战斗日志', { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(title.node, 0, 226);

    const lines = this.logs.slice(-12);
    lines.forEach((line, index) => {
      const label = makeLabel(panel, line, {
        fontSize: 14,
        color: COLORS.textDim,
        align: 'left',
        width: 420,
      });
      place(label.node, 0, 180 - index * 34);
    });

    const order = battle.order
      .map((uid) => {
        const unit = battle.units.find((item) => item.uid === uid);
        return unit ? `${unit.team === 0 ? '我' : '敌'}${speciesName(unit.speciesId)}` : uid;
      })
      .join(' → ');
    const orderLabel = makeLabel(panel, `行动顺序：${order || '-'}`, {
      fontSize: 12,
      color: '#6f8296',
      width: 420,
      wrap: true,
    });
    place(orderLabel.node, 0, -226);
  }

  private renderCommands(root: Node, frames: PlaceholderFrames, battle: BattleState): void {
    const engine = this.engine;
    if (!engine) return;
    const actor = battle.order[battle.cursor];
    const unit = battle.units.find((item) => item.uid === actor);
    if (!unit || unit.team !== 0) {
      const waiting = makeLabel(root, '敌方行动中…', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(waiting.node, 0, -430);
      return;
    }

    const available = engine.availableCommands(actor);
    const skillIds: string[] = [];
    for (const cmd of available) {
      if (cmd.type === 'skill' && !skillIds.includes(cmd.skillId)) skillIds.push(cmd.skillId);
    }
    const target = this.selectedTargetUid;
    const clickable = skillIds.filter((skillId) =>
      available.some(
        (cmd) =>
          cmd.type === 'skill' &&
          cmd.skillId === skillId &&
          (cmd.targetUids.length !== 1 || (target !== null && cmd.targetUids.includes(target))),
      ),
    );

    clickable.slice(0, 4).forEach((skillId, index) => {
      const skill = getConfigRepo().skill(skillId);
      const button = makeButton(
        root,
        `${skill.name} (${skill.cost})`,
        230,
        80,
        frames.white,
        () => this.onSkill(skillId, target),
        SELECTED_TINT,
      );
      place(button, -800 + index * 250, -430);
    });

    const auto = makeButton(root, '自动战斗', 230, 80, frames.white, () => this.runAuto());
    place(auto, 300, -430);
    const surrender = available.find((cmd) => cmd.type === 'surrender');
    if (surrender) {
      const giveUp = makeButton(root, '投降', 230, 80, frames.white, () => this.submit(surrender));
      place(giveUp, 570, -430);
    }
    const exit = makeButton(root, '放弃并退出', 200, 80, frames.white, () => this.abandon());
    place(exit, 820, -430);

    const tip = makeLabel(root, target ? '点击敌方卡片切换目标' : '选择一只敌方宠物作为目标', {
      fontSize: 14,
      color: COLORS.textDim,
    });
    place(tip.node, -800, -372);
  }

  private onSkill(skillId: string, targetUid: string | null): void {
    const engine = this.engine;
    if (!engine) return;
    const actor = engine.state.order[engine.state.cursor];
    const cmd = engine
      .availableCommands(actor)
      .find(
        (item) =>
          item.type === 'skill' &&
          item.skillId === skillId &&
          (item.targetUids.length !== 1 || (targetUid !== null && item.targetUids.includes(targetUid))),
      );
    if (!cmd) {
      this.view?.showToast('该技能需要选择其他目标');
      return;
    }
    this.submit(cmd);
  }

  private renderResult(root: Node, frames: PlaceholderFrames, battle: BattleState): void {
    const settlement = this.settlement;
    if (!settlement) return;
    if (settlement.error) {
      this.renderOverlay(
        root,
        frames,
        '结算失败',
        settlement.error,
        settlement.restart,
        undefined,
        settlement.restart ? undefined : '放弃并返回',
      );
      return;
    }
    if (settlement.claimed) {
      this.renderOverlay(
        root,
        frames,
        `战斗结果：${settlement.message}`,
        `${settlement.rewardsText}\n战斗指令已提交，奖励已发放。`,
        false,
        '返回关卡',
      );
      return;
    }
    if (settlement.claiming) {
      this.renderOverlay(root, frames, '结算中…', '正在提交完整指令序列，请稍候。', false);
      return;
    }
    const last = this.logs[this.logs.length - 1] ?? '';
    this.renderOverlay(
      root,
      frames,
      `战斗结束：${winnerText(battle.winner)}`,
      `已记录 ${this.commands.length} 条指令。\n${last}\n点击「结算奖励」提交给${this.session?.mode === 'server' ? '服务端重放校验' : '本地结算'}。`,
      false,
      '结算奖励',
      '放弃并返回',
    );
  }

  private async onClaim(): Promise<void> {
    const settlement = this.settlement;
    if (!settlement || settlement.claiming) return;
    settlement.claiming = true;
    settlement.error = null;
    this.view?.refresh();
    const result = await claimBattle(this.commands);
    settlement.claiming = false;
    if (result.ok) {
      settlement.claimed = true;
      settlement.message = result.message;
      settlement.rewardsText = describeRewards(result.rewards);
    } else {
      settlement.error = result.message;
      settlement.restart = result.restart === true;
    }
    this.view?.refresh();
  }

  private renderOverlay(
    root: Node,
    frames: PlaceholderFrames,
    titleText: string,
    bodyText: string,
    restart: boolean,
    primaryLabel?: string,
    secondaryLabel?: string,
  ): void {
    const panel = makePanel(root, 900, 500);
    paint(panel, frames.white, '#101c24');
    place(panel, 0, 60);

    const title = makeLabel(panel, titleText, {
      fontSize: FONT_SIZE.title,
      color: titleText.includes('失败') ? COLORS.danger : COLORS.accent,
      width: 820,
      wrap: true,
    });
    place(title.node, 0, 170);

    const body = makeLabel(panel, bodyText, {
      fontSize: FONT_SIZE.body,
      color: COLORS.text,
      width: 780,
      height: 220,
      wrap: true,
    });
    place(body.node, 0, 20);

    if (primaryLabel) {
      const primary = makeButton(panel, primaryLabel, 340, 82, frames.white, () => {
        if (primaryLabel === '结算奖励') void this.onClaim();
        else this.returnToStages();
      }, SELECTED_TINT);
      place(primary, -190, -170);
    }

    if (restart) {
      const again = makeButton(panel, '重开战斗', 340, 82, frames.white, () => this.returnToStages());
      place(again, primaryLabel ? 190 : 0, -170);
    } else if (secondaryLabel) {
      const secondary = makeButton(panel, secondaryLabel, 340, 82, frames.white, () => this.abandon());
      place(secondary, 190, -170);
    }
  }

  private abandon(): void {
    appStore.setBattle(null);
    gotoScene('stageSelect');
  }

  private returnToStages(): void {
    appStore.setBattle(null);
    gotoScene('stageSelect');
  }

  private ensureTarget(battle: BattleState): void {
    const enemies = battle.units.filter((unit) => unit.team === 1 && unit.alive);
    if (this.selectedTargetUid && enemies.some((unit) => unit.uid === this.selectedTargetUid)) return;
    this.selectedTargetUid = enemies[0]?.uid ?? null;
  }

  private unitFrame(unit: BattleUnit, frames: PlaceholderFrames) {
    if (unit.speciesId === 'turtle') return frames.petTurtle;
    if (unit.speciesId === 'fish') return frames.petFish;
    if (unit.speciesId === 'frog') return frames.petFrog;
    return frames.silhouette;
  }
}
