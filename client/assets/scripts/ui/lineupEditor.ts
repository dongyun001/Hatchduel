import { Node } from 'cc';
import type { PetInstance } from '../../lib/core';
import { createButton, createPanel, createTag } from './kit';
import { makeLabel, makeNode, makePanel, makeSprite, paint, place } from './nodes';
import type { PlaceholderFrames } from './placeholders';
import { elementTint, genderMark, petDisplayName, stageName } from './screens';
import { COLORS, FONT_SIZE, SPRITE_SIZE } from './theme';
import { createVirtualList } from './virtualList';

/**
 * 编队编辑（UI-07）：PvE 关卡与 PvP 进攻/防守共用同一套选择逻辑。
 * - `toggleLineupSelection`：纯函数，1~3 只上限；
 * - `createLineupStrip`：横向快捷条（StageSelect 顶部）；
 * - `createLineupPicker`：带虚拟列表的完整选择器（PvP 防守页 / 更换编队弹窗）。
 */

export const LINEUP_MAX = 3;

export interface ToggleResult {
  ids: string[];
  ok: boolean;
  reason?: string;
}

export function toggleLineupSelection(
  selected: readonly string[],
  petId: string,
  max = LINEUP_MAX,
): ToggleResult {
  if (selected.includes(petId)) {
    return { ids: selected.filter((id) => id !== petId), ok: true };
  }
  if (selected.length >= max) {
    return { ids: [...selected], ok: false, reason: `最多选择 ${max} 只，先取消一只` };
  }
  return { ids: [...selected, petId], ok: true };
}

function petChip(parent: Node, frames: PlaceholderFrames, pet: PetInstance, selected: boolean, onClick: () => void): Node {
  const chip = makePanel(parent, 220, 90);
  paint(chip, frames.white, selected ? '#2f5a70' : COLORS.panel);
  chip.on(Node.EventType.TOUCH_END, onClick);
  const icon = makeSprite(
    chip,
    frames.white,
    SPRITE_SIZE.icon32 * 2,
    SPRITE_SIZE.icon32 * 2,
    elementTint(pet.elementId),
  );
  place(icon.node, -72, 0);
  const label = makeLabel(chip, `${petDisplayName(pet)} ${genderMark(pet.gender)}\n${stageName(pet.stage)} Lv.${pet.level}`, {
    fontSize: 15,
    color: COLORS.text,
    width: 130,
    height: 52,
    wrap: true,
  });
  place(label.node, 42, 0);
  if (selected) {
    const tag = createTag(chip, frames, '已选', COLORS.good, { fontSize: 13, height: 22 });
    place(tag, 78, 32);
  }
  return chip;
}

export interface LineupStripOptions {
  pets: readonly PetInstance[];
  selected: readonly string[];
  frames: PlaceholderFrames;
  onToggle: (petId: string) => void;
  /** 只展示前 N 只（空间有限时）。 */
  visible?: number;
}

export function createLineupStrip(parent: Node, options: LineupStripOptions): Node {
  const pets = options.pets.slice(0, options.visible ?? options.pets.length);
  const strip = makeNode('lineup-strip', parent, pets.length * 240, 96);
  pets.forEach((pet, index) => {
    const chip = petChip(
      strip,
      options.frames,
      pet,
      options.selected.includes(pet.id),
      () => options.onToggle(pet.id),
    );
    place(chip, (index - (pets.length - 1) / 2) * 240, 0);
  });
  return strip;
}

export interface LineupPickerOptions {
  width: number;
  height: number;
  pets: readonly PetInstance[];
  selected: readonly string[];
  frames: PlaceholderFrames;
  title?: string;
  max?: number;
  min?: number;
  onChange: (ids: string[]) => void;
  /** 保留滚动位置（页面重绘时传入）。 */
  initialOffset?: number;
  onOffsetChange?: (offset: number) => void;
}

export interface LineupPickerHandle {
  node: Node;
  refresh(): void;
  getSelected(): string[];
}

const ROW_HEIGHT = 116;

export function createLineupPicker(parent: Node, options: LineupPickerOptions): LineupPickerHandle {
  const max = options.max ?? LINEUP_MAX;
  const node = makeNode('lineup-picker', parent, options.width, options.height);
  let selected = [...options.selected];

  const header = makeNode('lineup-header', node, options.width, 64);
  place(header, 0, options.height / 2 - 32);
  const title = makeLabel(header, options.title ?? '选择出战宠物', {
    fontSize: FONT_SIZE.heading,
    color: COLORS.text,
    align: 'left',
    width: options.width * 0.55,
  });
  place(title.node, -options.width * 0.2, 0);
  const count = makeLabel(header, `已选 ${selected.length}/${max}`, {
    fontSize: FONT_SIZE.small,
    color: COLORS.accent,
    align: 'right',
    width: options.width * 0.4,
  });
  place(count.node, options.width * 0.28, 0);

  const listHeight = options.height - 88;
  const listTop = options.height / 2 - 64 - listHeight / 2;
  const listNode = makeNode('lineup-list-holder', node, options.width, listHeight);
  place(listNode, 0, listTop);
  const list = createVirtualList<PetInstance>(listNode, options.frames, {
    width: options.width,
    height: listHeight,
    rowHeight: ROW_HEIGHT,
    gap: 8,
    items: options.pets,
    initialOffset: options.initialOffset,
    onOffsetChange: options.onOffsetChange,
    onSelect: (pet) => {
      const result = toggleLineupSelection(selected, pet.id, max);
      if (!result.ok) return;
      if (result.ids.length < (options.min ?? 0)) return;
      selected = result.ids;
      count.string = `已选 ${selected.length}/${max}`;
      options.onChange([...selected]);
      list.refresh();
    },
    renderRow: (pet, _index, row, width) => {
      const isSelected = selected.includes(pet.id);
      paint(row, options.frames.white, isSelected ? '#2f5a70' : COLORS.panelAlt);
      const icon = makeSprite(
        row,
        options.frames.white,
        SPRITE_SIZE.icon48 * 2,
        SPRITE_SIZE.icon48 * 2,
        elementTint(pet.elementId),
      );
      place(icon.node, -width / 2 + 70, 0);
      const name = makeLabel(row, `${petDisplayName(pet)} ${genderMark(pet.gender)}`, {
        fontSize: FONT_SIZE.body,
        color: COLORS.text,
        align: 'left',
        width: width * 0.4,
      });
      place(name.node, -width * 0.12, 22);
      const meta = makeLabel(row, `${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`, {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
        align: 'left',
        width: width * 0.4,
      });
      place(meta.node, -width * 0.12, -16);
      const state = createTag(row, options.frames, isSelected ? '已选' : '选择', isSelected ? COLORS.good : '#2b3d49', {
        fontSize: FONT_SIZE.small,
      });
      place(state, width / 2 - 90, 0);
    },
  });
  place(list.node, 0, 0);

  return {
    node,
    refresh(): void {
      count.string = `已选 ${selected.length}/${max}`;
      list.refresh();
    },
    getSelected: () => [...selected],
  };
}

/** 供页面展示的编队摘要。 */
export function lineupSummary(pets: readonly PetInstance[], selected: readonly string[]): string {
  if (selected.length === 0) return '未选择（至少 1 只）';
  const byId = new Map(pets.map((pet) => [pet.id, pet]));
  return selected
    .map((id) => {
      const pet = byId.get(id);
      return pet ? petDisplayName(pet) : id;
    })
    .join(' / ');
}

export function createLineupSaveButton(
  parent: Node,
  frames: PlaceholderFrames,
  onClick: () => void,
  disabled = false,
): Node {
  const button = createButton(parent, frames, {
    text: '保存编队',
    width: 200,
    height: 64,
    variant: 'primary',
    disabled,
    onClick,
  });
  return button;
}

export function createLineupPanel(parent: Node, frames: PlaceholderFrames, width: number, height: number): Node {
  return createPanel(parent, frames, width, height);
}
