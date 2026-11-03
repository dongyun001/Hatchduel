import { type Node, type Label, type SpriteFrame } from 'cc';
import type { ElementId, PetInstance } from '../../lib/core';
import { COLORS, FONT_SIZE, DESIGN } from './theme';
import type { PlaceholderFrames } from './placeholders';
import { makeLabel, makeNode, makePanel, makeSprite, paint, place } from './nodes';

export const SPECIES_NAMES: Record<string, string> = {
  turtle: '水龟',
  fish: '雷鱼',
  frog: '草蛙',
  cat: '火猫',
  snake: '土蛇',
};

const STAGE_NAMES: Record<PetInstance['stage'], string> = {
  egg: '蛋',
  juvenile: '幼年',
  adult: '成年',
  elder: '老年',
};

const ELEMENT_TINT: Record<ElementId, string> = {
  water: COLORS.water,
  thunder: COLORS.thunder,
  grass: COLORS.grass,
  fire: COLORS.danger,
  earth: '#a9793f',
};

const ELEMENT_NAMES: Record<ElementId, string> = {
  water: '水',
  fire: '火',
  grass: '草',
  earth: '土',
  thunder: '雷',
};

export function elementName(elementId: ElementId): string {
  return ELEMENT_NAMES[elementId] ?? elementId;
}

export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.05) return String(rounded);
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function statusColor(value: number): string {
  if (value >= 70) return COLORS.good;
  if (value >= 40) return COLORS.accent;
  return COLORS.danger;
}

/** 四项状态（饿/心/净/血）：小色块 + 数值，颜色按阈值。 */
export function createStatusRow(
  parent: Node,
  pet: PetInstance,
  frames: PlaceholderFrames,
  width = 300,
): Node {
  const row = makeNode('status-row', parent, width, 28);
  const items: Array<{ label: string; value: number }> = [
    { label: '饿', value: pet.condition.hunger },
    { label: '心', value: pet.condition.mood },
    { label: '净', value: pet.condition.hygiene },
    { label: '血', value: pet.condition.health },
  ];
  items.forEach((item, index) => {
    const x = (index - 1.5) * (width / 4);
    const dot = makeSprite(row, frames.white, 18, 18, statusColor(item.value));
    place(dot.node, x - 26, 0);
    const label = makeLabel(row, `${item.label}${Math.round(item.value)}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      align: 'left',
    });
    place(label.node, x + 18, 0);
  });
  return row;
}

export function speciesName(speciesId: string): string {
  return SPECIES_NAMES[speciesId] ?? speciesId;
}

/** 玩家改名优先；未改名时回退物种名（DOMAIN_MODEL PetInstance.name）。 */
export function petDisplayName(pet: PetInstance): string {
  const custom = pet.name?.trim();
  return custom && custom.length > 0 ? custom : speciesName(pet.speciesId);
}

export function stageName(stage: PetInstance['stage']): string {
  return STAGE_NAMES[stage];
}

export function elementTint(elementId: ElementId): string {
  return ELEMENT_TINT[elementId] ?? COLORS.panelAlt;
}

export function genderMark(gender: PetInstance['gender']): string {
  return gender === 'male' ? '♂' : '♀';
}

export function petFrame(speciesId: string, frames: PlaceholderFrames): SpriteFrame {
  if (speciesId === 'turtle') return frames.petTurtle;
  if (speciesId === 'fish') return frames.petFish;
  if (speciesId === 'frog') return frames.petFrog;
  return frames.white;
}

/** 全屏背景；所有场景的第一个子节点。 */
export function createBackground(parent: Node, frames: PlaceholderFrames): Node {
  const bg = makePanel(parent, DESIGN.width, DESIGN.height);
  paint(bg, frames.white, COLORS.bg);
  place(bg, 0, 0);
  return bg;
}

export function createTitle(parent: Node, text: string): Label {
  const label = makeLabel(parent, text, { fontSize: FONT_SIZE.title, color: COLORS.text });
  place(label.node, 0, 440);
  return label;
}
