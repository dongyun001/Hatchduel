import { _decorator, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState, PetFilter } from './store';
import { getConfigRepo } from '../services/config';
import { COLORS, DESIGN, FONT_SIZE, SPRITE_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makeNode, makePanel, makeSprite, paint, place } from '../ui/nodes';
import {
  createStatusRow,
  createTitle,
  elementName,
  elementTint,
  genderMark,
  petFrame,
  speciesName,
  stageName,
} from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';
import type { CodexKey, ElementId, PetInstance } from '../../lib/core';

const { ccclass } = _decorator;

const FILTERS: Array<{ id: PetFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'adult', label: '成年' },
  { id: 'juvenile', label: '幼年' },
  { id: 'egg', label: '蛋' },
];

const SELECTED_TINT = '#2f5a70';
const GENE_KEYS = ['hp', 'atk', 'def', 'spd'] as const;
const GENE_NAMES: Record<(typeof GENE_KEYS)[number], string> = {
  hp: '生命',
  atk: '攻击',
  def: '防御',
  spd: '速度',
};

function matchesFilter(pet: PetInstance, filter: PetFilter): boolean {
  if (filter === 'all') return true;
  return pet.stage === filter;
}

function bestGene(pet: PetInstance): { name: string; value: number } {
  let key: (typeof GENE_KEYS)[number] = 'hp';
  for (const candidate of GENE_KEYS) {
    if (pet.genome.stats[candidate] > pet.genome.stats[key]) key = candidate;
  }
  return { name: GENE_NAMES[key], value: pet.genome.stats[key] };
}

/**
 * PetList：宠物列表 + 阶段筛选 + 四项状态 + 5×5 图鉴（未拥有显示剪影）+ 最佳基因。
 * 只读 store；点击卡片写 selectedPetId 后进详情。
 */
@ccclass('PetListController')
export class PetListController extends Component {
  private view: SceneView | null = null;

  start(): void {
    this.view = new SceneView(this, 'petlist-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '宠物列表');
    place(title.node, 0, 480);

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      return;
    }

    const pets = Object.values(profile.pets);

    // —— 筛选 ——
    FILTERS.forEach((filter, index) => {
      const count = pets.filter((pet) => matchesFilter(pet, filter.id)).length;
      const active = state.ui.petFilter === filter.id;
      const button = makeButton(
        root,
        `${filter.label} ${count}`,
        200,
        64,
        frames.white,
        () => appStore.setPetFilter(filter.id),
        active ? SELECTED_TINT : COLORS.panelAlt,
      );
      place(button, (index - 1.5) * 220, 400);
    });

    // —— 左侧列表 ——
    const listPanel = makePanel(root, 920, 760);
    paint(listPanel, frames.white, COLORS.panel);
    place(listPanel, -450, 0);

    const filtered = pets.filter((pet) => matchesFilter(pet, state.ui.petFilter)).slice(0, 5);
    if (filtered.length === 0) {
      const empty = makeLabel(listPanel, '没有符合条件的宠物', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(empty.node, 0, 0);
    }
    filtered.forEach((pet, index) => {
      const card = this.createListCard(listPanel, pet, frames);
      place(card.node, 0, 300 - index * 148);
    });
    const hidden = pets.filter((pet) => matchesFilter(pet, state.ui.petFilter)).length - filtered.length;
    if (hidden > 0) {
      const more = makeLabel(listPanel, `还有 ${hidden} 只未显示（列表虚拟化待做）`, {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
      });
      place(more.node, 0, -330);
    }

    // —— 右侧图鉴 5×5 ——
    this.renderCodex(root, frames, profile);

    const back = makeButton(root, '返回主页', 360, 84, frames.white, () => gotoScene('home'));
    place(back, 0, -450);

    const hint = makeLabel(root, '点击宠物查看八项属性、基因、特质、血统与技能', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(hint.node, 0, -510);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -390);
    }
  }

  private createListCard(parent: Node, pet: PetInstance, frames: PlaceholderFrames): { node: Node } {
    const card = makePanel(parent, 860, 132);
    paint(card, frames.white, COLORS.panelAlt);
    card.on(Node.EventType.TOUCH_END, () => {
      appStore.setSelectedPet(pet.id);
      gotoScene('petDetail');
    });

    const iconSize = SPRITE_SIZE.icon48 * DESIGN.pixelScale;
    const icon = makeSprite(card, petFrame(pet.speciesId, frames), iconSize, iconSize, elementTint(pet.elementId));
    place(icon.node, -350, 0);

    const name = makeLabel(card, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}`, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
      align: 'left',
      width: 460,
    });
    place(name.node, -30, 30);

    const meta = makeLabel(card, `${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      align: 'left',
      width: 460,
    });
    place(meta.node, -30, -2);

    const status = createStatusRow(card, pet, frames, 320);
    place(status, 170, -30);

    const best = bestGene(pet);
    const bestLabel = makeLabel(card, `最佳基因 ${best.name} ${best.value}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.accent,
      align: 'right',
    });
    place(bestLabel.node, 250, 34);

    return { node: card };
  }

  private renderCodex(
    root: Node,
    frames: PlaceholderFrames,
    profile: NonNullable<AppState['profile']>,
  ): void {
    const panel = makePanel(root, 840, 760);
    paint(panel, frames.white, COLORS.panel);
    place(panel, 560, 0);

    const codexTitle = makeLabel(panel, '图鉴（5×5）', { fontSize: FONT_SIZE.heading, color: COLORS.text });
    place(codexTitle.node, 0, 350);

    const cfg = getConfigRepo();
    const speciesList = cfg.allSpecies();
    const elements = cfg.allElements();
    const cell = 124;
    const gap = 8;
    const startX = -((speciesList.length - 1) / 2) * (cell + gap);
    const startY = ((elements.length - 1) / 2) * (cell + gap);

    elements.forEach((element, row) => {
      speciesList.forEach((species, col) => {
        const key = `${species.id}:${element.id}` as CodexKey;
        const entry = profile.codex[key];
        const owned = Boolean(entry?.owned);
        const x = startX + col * (cell + gap);
        const y = startY - row * (cell + gap);
        const tile = makeNode(`codex-${key}`, panel, cell, cell);
        place(tile, x, y);
        const bg = makePanel(tile, cell, cell);
        paint(bg, frames.white, owned ? '#1f3644' : '#141e26');
        place(bg, 0, 0);

        const icon = makeSprite(
          tile,
          owned ? petFrame(species.id, frames) : frames.silhouette,
          SPRITE_SIZE.icon32 * DESIGN.pixelScale,
          SPRITE_SIZE.icon32 * DESIGN.pixelScale,
          owned ? elementTint(element.id as ElementId) : '#202a33',
        );
        place(icon.node, 0, 14);

        const text = owned
          ? `${species.name}·${elementName(element.id)}\nBG ${entry?.bestGene ?? 0}`
          : `${species.name}·${elementName(element.id)}\n未获得`;
        const label = makeLabel(tile, text, {
          fontSize: 13,
          color: owned ? COLORS.textDim : '#5a6b78',
          width: cell - 10,
          height: 34,
          wrap: true,
        });
        place(label.node, 0, -42);

        if (owned) {
          tile.on(Node.EventType.TOUCH_END, () => {
            const first = Object.values(profile.pets).find(
              (pet) => pet.speciesId === species.id && pet.elementId === element.id,
            );
            if (first) {
              appStore.setSelectedPet(first.id);
              gotoScene('petDetail');
            } else {
              appStore.setToast(`${species.name}·${elementName(element.id)} 已在图鉴，但当前没有该个体`);
            }
          });
        }
      });
    });
  }
}
