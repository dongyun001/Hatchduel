import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import { COLORS, DESIGN, FONT_SIZE } from '../ui/theme';
import { clearChildren, makeButton, makeLabel, makeNode, place } from '../ui/nodes';
import { createBackground, createPetCard, createResourceBar, createTitle, speciesName, stageName } from '../ui/screens';
import { preloadPlaceholders } from '../ui/placeholders';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

/**
 * Home：资源栏 + 3 只宠物卡片 + 进入栖息地。
 * 只读 appStore；点击卡片/按钮只改 store 或切场景。
 */
@ccclass('HomeController')
export class HomeController extends Component {
  private root: Node | null = null;
  private frames: PlaceholderFrames | null = null;
  private unsubscribe: (() => void) | null = null;
  private renderQueued = false;

  start(): void {
    void this.init();
  }

  onDestroy(): void {
    this.unsubscribe?.();
  }

  private async init(): Promise<void> {
    this.frames = await preloadPlaceholders();
    this.root = makeNode('home-root', this.node, DESIGN.width, DESIGN.height);
    this.unsubscribe = appStore.subscribe(() => this.queueRender());
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.scheduleOnce(() => {
      this.renderQueued = false;
      this.render();
    }, 0);
  }

  private render(): void {
    const root = this.root;
    const frames = this.frames;
    if (!root || !frames) return;

    const state = appStore.getState();
    clearChildren(root);
    createBackground(root, frames);
    createTitle(root, '主页');

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      makeButton(root, '重新启动', 360, 96, frames.white, () => gotoScene('boot'));
      return;
    }

    createResourceBar(root, profile, frames);

    const pets = Object.values(profile.pets).slice(0, 3);
    pets.forEach((pet, index) => {
      const card = createPetCard(root, pet, frames, {
        onClick: (clicked) => {
          const g = clicked.genome.stats;
          this.showToast(`${speciesName(clicked.speciesId)} · ${stageName(clicked.stage)} · 基因 HP${g.hp}/ATK${g.atk}/DEF${g.def}/SPD${g.spd}`);
        },
      });
      place(card, (index - (pets.length - 1) / 2) * 380, 40);
    });

    const toList = makeButton(root, '宠物列表', 300, 90, frames.white, () => gotoScene('petList'));
    place(toList, -540, -320);
    const toBreeding = makeButton(root, '繁殖', 300, 90, frames.white, () => gotoScene('breeding'));
    place(toBreeding, -180, -320);
    const toStages = makeButton(root, '关卡战斗', 300, 90, frames.white, () => gotoScene('stageSelect'));
    place(toStages, 180, -320);
    const enter = makeButton(root, '进入栖息地', 300, 90, frames.white, () => gotoScene('habitat'));
    place(enter, 540, -320);

    const mode =
      state.remote.mode === 'mock'
        ? '离线演示（mock profile，不依赖服务端）'
        : `服务端 · revision ${profile.revision} · 时间偏移 ${Math.round(state.remote.serverTimeOffsetMs / 1000)}s`;
    const footer = makeLabel(root, `平台 ${state.platformKind ?? '-'} · ${mode}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(footer.node, 0, -460);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -390);
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
