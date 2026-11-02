import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { loadPvpOverview } from '../services/pvpActions';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel, createPetCard, createResourceBar, renderToast } from '../ui/kit';
import { makeLabel, place } from '../ui/nodes';
import { createTitle, speciesName, stageName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

/**
 * Home：资源栏 + 宠物卡片 + PvP 入口（M2-01）+ 四个主入口。
 * 只读 appStore；PvP 概览在进入页面时拉一次（/profile 的 rating + /pvp/defense + 剩余次数）。
 */
@ccclass('HomeController')
export class HomeController extends Component {
  private view: SceneView | null = null;

  start(): void {
    this.view = new SceneView(this, 'home-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init().then(() => {
      void loadPvpOverview();
    });
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '主页');
    place(title.node, 0, 440);

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      const restart = createButton(root, frames, {
        text: '重新启动',
        width: 360,
        height: 96,
        variant: 'primary',
        onClick: () => gotoScene('boot'),
      });
      place(restart, 0, -60);
      renderToast(root, state.ui.toast, frames);
      return;
    }

    createResourceBar(root, profile, frames);

    const pets = Object.values(profile.pets).slice(0, 3);
    pets.forEach((pet, index) => {
      const card = createPetCard(root, pet, frames, {
        onClick: (clicked) => {
          const g = clicked.genome.stats;
          this.showToast(
            `${speciesName(clicked.speciesId)} · ${stageName(clicked.stage)} · 基因 HP${g.hp}/ATK${g.atk}/DEF${g.def}/SPD${g.spd}`,
          );
        },
      });
      place(card, (index - (pets.length - 1) / 2) * 380, 60);
    });

    this.renderPvpStrip(root, frames, state);

    const nav: Array<{ text: string; x: number; onClick: () => void }> = [
      { text: '宠物列表', x: -540, onClick: () => gotoScene('petList') },
      { text: '繁殖', x: -180, onClick: () => gotoScene('breeding') },
      { text: '关卡战斗', x: 180, onClick: () => gotoScene('stageSelect') },
      { text: '进入栖息地', x: 540, onClick: () => gotoScene('habitat') },
    ];
    nav.forEach((item) => {
      const button = createButton(root, frames, {
        text: item.text,
        width: 300,
        height: 84,
        variant: 'secondary',
        onClick: item.onClick,
      });
      place(button, item.x, -360);
    });

    const mode =
      state.remote.mode === 'mock'
        ? '离线演示（mock profile，不依赖服务端）'
        : `服务端 · revision ${profile.revision} · 时间偏移 ${Math.round(state.remote.serverTimeOffsetMs / 1000)}s`;
    const footer = makeLabel(root, `平台 ${state.platformKind ?? '-'} · ${mode}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(footer.node, 0, -470);

    renderToast(root, state.ui.toast, frames);
  }

  private renderPvpStrip(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const profile = state.profile;
    if (!profile) return;
    const overview = state.pvp.overview;
    const strip = createPanel(root, frames, 1800, 100, COLORS.panelAlt);
    place(strip, 0, -235);

    const defense = overview.defense;
    const defenseText = defense ? (defense.stale ? '防守已过期' : '防守已设置') : '防守未设置';
    const remaining =
      overview.challengesRemaining === null ? '—' : `${overview.challengesRemaining}/${overview.dailyLimit ?? 10}`;
    const status = overview.loading
      ? 'PvP 状态加载中…'
      : `段位 ${profile.pvp.rating} · 今日剩余 ${remaining} · ${defenseText}`;
    const statusColor = overview.error ? COLORS.danger : defense?.stale ? COLORS.accent : COLORS.text;

    const label = makeLabel(strip, status, {
      fontSize: FONT_SIZE.body,
      color: statusColor,
      align: 'left',
      width: 980,
    });
    place(label.node, -330, 0);

    if (overview.error) {
      const error = makeLabel(strip, overview.error, {
        fontSize: FONT_SIZE.small,
        color: COLORS.danger,
        align: 'left',
        width: 960,
      });
      place(error.node, -330, -34);
    } else if (defense?.stale) {
      const hint = makeLabel(strip, '快照超过 24h，建议重新设置（仍可被匹配）', {
        fontSize: FONT_SIZE.small,
        color: COLORS.accent,
        align: 'left',
        width: 960,
      });
      place(hint.node, -330, -34);
    }

    const actions: Array<{ text: string; x: number; onClick: () => void; variant: 'primary' | 'secondary' }> = [
      { text: '防守设置', x: 360, onClick: () => gotoScene('pvpDefense'), variant: 'secondary' },
      { text: '开始匹配', x: 590, onClick: () => gotoScene('pvpOpponent'), variant: 'primary' },
      { text: '排行榜', x: 800, onClick: () => gotoScene('leaderboard'), variant: 'secondary' },
    ];
    actions.forEach((action) => {
      const button = createButton(strip, frames, {
        text: action.text,
        width: 190,
        height: 64,
        variant: action.variant,
        onClick: action.onClick,
      });
      place(button, action.x, 0);
    });

    if (overview.error) {
      const retry = createButton(strip, frames, {
        text: '重试',
        width: 120,
        height: 40,
        variant: 'ghost',
        fontSize: FONT_SIZE.small,
        onClick: () => void loadPvpOverview(),
      });
      place(retry, 660, -36);
    }
  }

  private showToast(message: string): void {
    appStore.setToast(message);
    this.unschedule(this.clearToast);
    this.scheduleOnce(this.clearToast, 2.5);
  }

  private clearToast = (): void => {
    appStore.setToast(null);
  };
}
