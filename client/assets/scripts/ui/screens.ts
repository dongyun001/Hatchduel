import { Node, type Label, type SpriteFrame } from 'cc';
import type { ElementId, PetInstance, Profile } from '../../lib/core';
import { COLORS, FONT_SIZE, SPRITE_SIZE, DESIGN } from './theme';
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

export function createResourceBar(parent: Node, profile: Profile, frames: PlaceholderFrames): Node {
  const bar = makeNode('resource-bar', parent, 1200, 96);
  place(bar, 0, 350);

  const entries: Array<{ icon: SpriteFrame; value: number; label: string }> = [
    { icon: frames.iconCoin, value: profile.currencies.coin, label: '金币' },
    { icon: frames.iconFood, value: profile.currencies.food, label: '食物' },
    { icon: frames.iconGene, value: profile.currencies.geneDust, label: '基因尘' },
  ];

  entries.forEach((entry, index) => {
    const group = makeNode(`resource-${entry.label}`, bar, 340, 96);
    place(group, (index - 1) * 380, 0);
    const icon = makeSprite(group, entry.icon, SPRITE_SIZE.icon32 * DESIGN.pixelScale, SPRITE_SIZE.icon32 * DESIGN.pixelScale);
    place(icon.node, -110, 0);
    const label = makeLabel(group, `${entry.label} ${formatAmount(entry.value)}`, {
      fontSize: FONT_SIZE.body,
      color: COLORS.text,
      align: 'left',
    });
    place(label.node, 60, 0);
  });

  return bar;
}

export interface PetCardOptions {
  width?: number;
  height?: number;
  showStats?: boolean;
  onClick?: (pet: PetInstance) => void;
}

/** 宠物卡片：同尺寸占位图 + 名称/阶段/等级，点击回调由场景决定。 */
export function createPetCard(
  parent: Node,
  pet: PetInstance,
  frames: PlaceholderFrames,
  options: PetCardOptions = {},
): Node {
  const width = options.width ?? 340;
  const height = options.height ?? 460;
  const card = makePanel(parent, width, height);
  paint(card, frames.white, COLORS.panel);
  card.on(Node.EventType.TOUCH_END, () => options.onClick?.(pet));

  const spriteSize = SPRITE_SIZE.pet * DESIGN.pixelScale;
  const sprite = makeSprite(card, petFrame(pet.speciesId, frames), spriteSize, spriteSize, elementTint(pet.elementId));
  place(sprite.node, 0, height / 2 - spriteSize / 2 - 36);

  const name = makeLabel(card, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}`, {
    fontSize: FONT_SIZE.heading,
    color: COLORS.text,
  });
  place(name.node, 0, -118);

  const meta = makeLabel(card, `${stageName(pet.stage)} · Lv.${pet.level}`, {
    fontSize: FONT_SIZE.small,
    color: COLORS.textDim,
  });
  place(meta.node, 0, -155);

  if (options.showStats !== false) {
    const stats = makeLabel(card, `HP ${pet.genome.stats.hp}  ATK ${pet.genome.stats.atk}\nDEF ${pet.genome.stats.def}  SPD ${pet.genome.stats.spd}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      width: width - 24,
      height: 52,
      wrap: true,
    });
    place(stats.node, 0, -196);
  }

  if (pet.habitatId !== null) {
    const badge = makeLabel(card, '栖息地中', { fontSize: FONT_SIZE.small, color: COLORS.good });
    place(badge.node, 0, height / 2 - 24);
  }

  return card;
}
