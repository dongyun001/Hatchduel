import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import { getConfigRepo } from '../services/config';
import {
  cleanPetAction,
  collectHabitatAction,
  feedPetAction,
  movePetAction,
  playWithPetAction,
  upgradeHabitatAction,
} from '../services/habitatActions';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makePanel, paint, place } from '../ui/nodes';
import { createPetCard, createTitle, formatAmount, stageName, speciesName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';
import type { AppState } from './store';

const { ccclass } = _decorator;

/** 选中卡片的底色（比 panel/panelAlt 更明显）。 */
const SELECTED_TINT = '#2f5a70';

/**
 * Habitat：栖息地槽位 + 收取/喂食/清洁/陪玩/升级/移出。
 * 动作统一走 `services/habitatActions`：服务端模式走 ROUTES，离线模式走 core 纯函数。
 */
@ccclass('HabitatController')
export class HabitatController extends Component {
  private view: SceneView | null = null;

  start(): void {
    this.view = new SceneView(this, 'habitat-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    createTitle(root, '栖息地');

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      return;
    }

    const habitat = Object.values(profile.habitats)[0];
    const backdrop = makePanel(root, 1600, 560);
    paint(backdrop, frames.white, COLORS.panel);
    place(backdrop, 0, 100);

    if (!habitat) {
      const empty = makeLabel(root, '还没有栖息地', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(empty.node, 0, 100);
      return;
    }

    const selectedId = this.resolveSelectedId(state, habitat.slots);
    habitat.slots.forEach((petId, index) => {
      const x = (index - (habitat.slots.length - 1) / 2) * 370;
      const pet = petId ? profile.pets[petId] : undefined;
      if (!pet) {
        const slot = makePanel(root, 340, 460);
        paint(slot, frames.white, COLORS.panelAlt);
        place(slot, x, 110);
        const label = makeLabel(slot, '空槽位', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
        place(label.node, 0, 0);
        return;
      }
      const card = createPetCard(root, pet, frames, {
        onClick: (clicked) => appStore.setSelectedPet(clicked.id),
      });
      if (selectedId === pet.id) paint(card, frames.white, SELECTED_TINT);
      place(card, x, 110);
    });

    const stored = habitat.stored;
    const storedText = `未领取：金币 ${formatAmount(stored.coin ?? 0)} · 食物 ${formatAmount(stored.food ?? 0)} · 基因尘 ${formatAmount(stored.geneDust ?? 0)}`;
    const storedLabel = makeLabel(root, storedText, { fontSize: FONT_SIZE.body, color: COLORS.textDim });
    place(storedLabel.node, 0, -210);

    const selectedPet = selectedId ? profile.pets[selectedId] : undefined;
    const selectedText = selectedPet
      ? `当前：${speciesName(selectedPet.speciesId)}（${stageName(selectedPet.stage)}）`
      : '先点选一只宠物';
    const selectedLabel = makeLabel(root, selectedText, { fontSize: FONT_SIZE.small, color: COLORS.accent });
    place(selectedLabel.node, 720, -440);

    const collect = makeButton(root, '收取产出', 340, 84, frames.white, () => void this.onCollect(habitat.id));
    place(collect, -570, -330);
    const upgrade = makeButton(root, '升级栖息地', 340, 84, frames.white, () => void this.onUpgrade(habitat.id));
    place(upgrade, -190, -330);
    const moveOut = makeButton(root, '移出栖息地', 340, 84, frames.white, () => void this.onMoveOut(selectedId));
    place(moveOut, 190, -330);
    const back = makeButton(root, '返回主页', 340, 84, frames.white, () => gotoScene('home'));
    place(back, 570, -330);

    const feed = makeButton(root, '喂食', 340, 84, frames.white, () => void this.onFeed(selectedId));
    place(feed, -420, -440);
    const clean = makeButton(root, '清洁', 340, 84, frames.white, () => void this.onClean(selectedId));
    place(clean, 0, -440);
    const play = makeButton(root, '陪玩', 340, 84, frames.white, () => void this.onPlay(selectedId));
    place(play, 420, -440);

    const mode =
      state.remote.mode === 'mock'
        ? '离线演示：动作走 core 纯函数，未经过服务端'
        : `服务端模式 · revision ${profile.revision}`;
    const footer = makeLabel(root, mode, { fontSize: FONT_SIZE.small, color: COLORS.textDim });
    place(footer.node, 0, -505);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -270);
    }
  }

  private resolveSelectedId(state: Readonly<AppState>, slots: ReadonlyArray<string | null>): string | null {
    const selected = state.ui.selectedPetId;
    if (selected && slots.includes(selected)) return selected;
    return slots.find((id): id is string => id !== null) ?? null;
  }

  private requirePet(petId: string | null): petId is string {
    if (petId) return true;
    this.view?.showToast('先点选一只宠物');
    return false;
  }

  private async onCollect(habitatId: string): Promise<void> {
    const result = await collectHabitatAction(habitatId);
    this.view?.showToast(result.message);
  }

  private async onUpgrade(habitatId: string): Promise<void> {
    const result = await upgradeHabitatAction(habitatId);
    this.view?.showToast(result.message);
  }

  private async onMoveOut(petId: string | null): Promise<void> {
    if (!this.requirePet(petId)) return;
    const result = await movePetAction(petId, null);
    this.view?.showToast(result.message);
  }

  private async onFeed(petId: string | null): Promise<void> {
    if (!this.requirePet(petId)) return;
    const food = getConfigRepo().allFoods()[0];
    if (!food) {
      this.view?.showToast('没有可用食物配置');
      return;
    }
    const result = await feedPetAction(petId, food.id);
    this.view?.showToast(`${result.message}${result.ok ? ` · ${food.name}` : ''}`);
  }

  private async onClean(petId: string | null): Promise<void> {
    if (!this.requirePet(petId)) return;
    const result = await cleanPetAction(petId);
    this.view?.showToast(result.message);
  }

  private async onPlay(petId: string | null): Promise<void> {
    if (!this.requirePet(petId)) return;
    const result = await playWithPetAction(petId);
    this.view?.showToast(result.message);
  }
}
