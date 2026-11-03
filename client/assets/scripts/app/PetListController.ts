import { _decorator, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState, PetFilter } from './store';
import { getConfigRepo } from '../services/config';
import { createButton, createPanel, renderToast } from '../ui/kit';
import { createEmptyState, createErrorState } from '../ui/states';
import { COLORS, FONT_SIZE, SPRITE_SIZE } from '../ui/theme';
import { makeLabel, makePanel, makeSprite, paint, place } from '../ui/nodes';
import {
  createStatusRow,
  createTitle,
  elementName,
  elementTint,
  genderMark,
  petDisplayName,
  petFrame,
  stageName,
} from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import { createVirtualList } from '../ui/virtualList';
import type { PlaceholderFrames } from '../ui/placeholders';
import type { CodexKey, ElementId, PetInstance } from '../../lib/core';

const { ccclass } = _decorator;

const FILTERS: Array<{ id: PetFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'adult', label: '成年' },
  { id: 'juvenile', label: '幼年' },
  { id: 'egg', label: '蛋' },
];

const ROW_HEIGHT = 132;
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
 * PetList：阶段筛选 + 虚拟化宠物列表（UI-05）+ 5×5 图鉴 + 最佳基因。
 * 40+ 只时只实例化视口内的行；拖动滚动位置在 store 重绘之间保留。
 */
@ccclass('PetListController')
export class PetListController extends Component {
  private view: SceneView | null = null;
  private listOffset = 0;

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
    place(title.node, 0, 460);

    const profile = state.profile;
    if (!profile) {
      const error = createErrorState(root, frames, {
        message: '没有存档，无法显示宠物列表。请从 Boot 重新启动。',
        retryText: '重新启动',
        onRetry: () => gotoScene('boot'),
      });
      place(error, 0, 0);
      renderToast(root, state.ui.toast, frames);
      return;
    }

    const pets = Object.values(profile.pets);

    // —— 筛选 ——
    FILTERS.forEach((filter, index) => {
      const count = pets.filter((pet) => matchesFilter(pet, filter.id)).length;
      const active = state.ui.petFilter === filter.id;
      const button = createButton(root, frames, {
        text: `${filter.label} ${count}`,
        width: 200,
        height: 64,
        variant: active ? 'primary' : 'secondary',
        onClick: () => {
          this.listOffset = 0;
          appStore.setPetFilter(filter.id);
        },
      });
      place(button, (index - 1.5) * 220, 400);
    });

    // —— 左侧列表 ——
    const listPanel = createPanel(root, frames, 920, 720, COLORS.panel);
    place(listPanel, -450, -40);
    const filtered = pets.filter((pet) => matchesFilter(pet, state.ui.petFilter));

    if (filtered.length === 0) {
      const empty = createEmptyState(listPanel, frames, {
        text: '没有符合条件的宠物',
        actionText: '查看全部',
        onAction: () => appStore.setPetFilter('all'),
      });
      place(empty, 0, 0);
    } else {
      const header = makeLabel(listPanel, `${filtered.length} 只 · 拖动列表滚动`, {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
        align: 'left',
        width: 840,
      });
      place(header.node, 0, 326);

      const list = createVirtualList<PetInstance>(listPanel, frames, {
        width: 860,
        height: 600,
        rowHeight: ROW_HEIGHT,
        gap: 8,
        items: filtered,
        initialOffset: this.listOffset,
        onOffsetChange: (offset) => {
          this.listOffset = offset;
        },
        onSelect: (pet) => {
          appStore.setSelectedPet(pet.id);
          gotoScene('petDetail');
        },
        renderRow: (pet, _index, row, width) => this.renderListRow(row, width, pet, frames),
      });
      place(list.node, 0, -24);

      const hint = makeLabel(listPanel, '点击查看八项属性、基因、特质、血统与技能', {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
      });
      place(hint.node, 0, -330);
    }

    // —— 右侧图鉴 5×5 ——
    this.renderCodex(root, frames, profile);

    const back = createButton(root, frames, {
      text: '返回主页',
      width: 360,
      height: 84,
      variant: 'secondary',
      onClick: () => gotoScene('home'),
    });
    place(back, 0, -450);

    renderToast(root, state.ui.toast, frames);
  }

  private renderListRow(row: Node, width: number, pet: PetInstance, frames: PlaceholderFrames): void {
    paint(row, frames.white, COLORS.panelAlt);

    const iconSize = SPRITE_SIZE.icon48 * 2;
    const icon = makeSprite(row, petFrame(pet.speciesId, frames), iconSize, iconSize, elementTint(pet.elementId));
    place(icon.node, -width / 2 + 70, 0);

    const name = makeLabel(row, `${petDisplayName(pet)} ${genderMark(pet.gender)}`, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
      align: 'left',
      width: 420,
    });
    place(name.node, -width / 2 + 310, 28);

    const meta = makeLabel(row, `${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      align: 'left',
      width: 420,
    });
    place(meta.node, -width / 2 + 310, -4);

    const status = createStatusRow(row, pet, frames, 320);
    place(status, 170, -32);

    const best = bestGene(pet);
    const bestLabel = makeLabel(row, `最佳基因 ${best.name} ${best.value}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.accent,
      align: 'right',
    });
    place(bestLabel.node, width / 2 - 170, 30);
  }

  private renderCodex(
    root: Node,
    frames: PlaceholderFrames,
    profile: NonNullable<AppState['profile']>,
  ): void {
    const panel = createPanel(root, frames, 840, 720, COLORS.panel);
    place(panel, 560, -40);

    const codexTitle = makeLabel(panel, '图鉴（5×5）', { fontSize: FONT_SIZE.heading, color: COLORS.text });
    place(codexTitle.node, 0, 300);

    const cfg = getConfigRepo();
    const speciesList = cfg.allSpecies();
    const elements = cfg.allElements();
    const cell = 112;
    const gap = 6;
    const startX = -((speciesList.length - 1) / 2) * (cell + gap);
    const startY = ((elements.length - 1) / 2) * (cell + gap);

    elements.forEach((element, row) => {
      speciesList.forEach((species, col) => {
        const key = `${species.id}:${element.id}` as CodexKey;
        const entry = profile.codex[key];
        const owned = Boolean(entry?.owned);
        const x = startX + col * (cell + gap);
        const y = startY - row * (cell + gap);
        const tile = makePanel(panel, cell, cell);
        place(tile, x, y);
        paint(tile, frames.white, owned ? '#1f3644' : '#141e26');

        const icon = makeSprite(
          tile,
          owned ? petFrame(species.id, frames) : frames.silhouette,
          SPRITE_SIZE.icon32 * 2,
          SPRITE_SIZE.icon32 * 2,
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
