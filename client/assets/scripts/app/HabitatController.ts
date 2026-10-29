import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import { nowMs } from '../services/bootstrap';
import { collectStored, feedAll } from '../dev/mockActions';
import { COLORS, DESIGN, FONT_SIZE } from '../ui/theme';
import { clearChildren, makeButton, makeLabel, makeNode, makePanel, paint, place } from '../ui/nodes';
import { createBackground, createPetCard, createTitle, stageName } from '../ui/screens';
import { preloadPlaceholders } from '../ui/placeholders';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

/**
 * Habitat：栖息地 4 个槽位、未领取产出、收取/喂食（仅 mock 模式的本地演示）。
 * 服务端模式下的写操作必须走 `/habitat/*`，由服务器计算并返回 ProfilePatch（M1 未接）。
 */
@ccclass('HabitatController')
export class HabitatController extends Component {
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
    this.root = makeNode('habitat-root', this.node, DESIGN.width, DESIGN.height);
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
    createTitle(root, '栖息地');

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      return;
    }

    const habitat = Object.values(profile.habitats)[0];
    const backdrop = makePanel(root, 1600, 580);
    paint(backdrop, frames.white, COLORS.panel);
    place(backdrop, 0, 70);

    if (!habitat) {
      const empty = makeLabel(root, '还没有栖息地', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(empty.node, 0, 70);
    } else {
      habitat.slots.forEach((petId, index) => {
        const x = (index - (habitat.slots.length - 1) / 2) * 370;
        const pet = petId ? profile.pets[petId] : undefined;
        if (!pet) {
          const slot = makePanel(root, 340, 460);
          paint(slot, frames.white, COLORS.panelAlt);
          place(slot, x, 90);
          const label = makeLabel(slot, '空槽位', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
          place(label.node, 0, 0);
          return;
        }
        const card = createPetCard(root, pet, frames, {
          onClick: (clicked) => {
            this.showToast(`${stageName(clicked.stage)} · 饥饿 ${Math.round(clicked.condition.hunger)} · 心情 ${Math.round(clicked.condition.mood)}`);
          },
        });
        place(card, x, 90);
      });

      const stored = habitat.stored;
      const storedText = `未领取：金币 ${stored.coin ?? 0} · 食物 ${stored.food ?? 0} · 基因尘 ${stored.geneDust ?? 0}`;
      const storedLabel = makeLabel(root, storedText, { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(storedLabel.node, 0, -250);
    }

    const collect = makeButton(root, '收取产出', 380, 96, frames.white, () => this.onCollect());
    place(collect, -540, -370);
    const feed = makeButton(root, '喂食全部', 380, 96, frames.white, () => this.onFeed());
    place(feed, 0, -370);
    const back = makeButton(root, '返回主页', 380, 96, frames.white, () => gotoScene('home'));
    place(back, 540, -370);

    const mode =
      state.remote.mode === 'mock'
        ? '离线演示：收取/喂食只改本地 store，未经过服务端'
        : `服务端模式 · revision ${profile.revision}`;
    const footer = makeLabel(root, mode, { fontSize: FONT_SIZE.small, color: COLORS.textDim });
    place(footer.node, 0, -470);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -305);
    }
  }

  private onCollect(): void {
    const profile = appStore.getState().profile;
    if (!profile || !this.isMock()) return;
    const result = collectStored(profile, nowMs());
    appStore.setProfile(result.profile);
    this.showToast(`收取 ${result.collected} 金币（离线演示）`);
  }

  private onFeed(): void {
    const profile = appStore.getState().profile;
    if (!profile || !this.isMock()) return;
    const result = feedAll(profile, nowMs());
    appStore.setProfile(result.profile);
    this.showToast(result.message);
  }

  private isMock(): boolean {
    if (appStore.getState().remote.mode === 'mock') return true;
    this.showToast('写操作需要服务端（M1 未接）');
    return false;
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
