import { BlockInputEvents, Button, Label, Node, UITransform, type SpriteFrame } from 'cc';
import { COLORS, FONT_SIZE, SPRITE_SIZE } from './theme';
import { clearChildren, makeLabel, makeNode, makePanel, makeSprite, paint, place } from './nodes';
import {
  elementTint,
  formatAmount,
  genderMark,
  petDisplayName,
  petFrame,
  stageName,
} from './screens';
import type { PlaceholderFrames } from './placeholders';
import type { PetInstance, Profile } from '../../lib/core';

/**
 * UI kit（UI_BACKLOG UI-01）：按钮/面板/弹窗/Toast/Tag/资源栏/宠物卡片。
 * 新页面只从这里取组件；旧页面逐步替换，避免再手搓一套。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT_TINT: Record<ButtonVariant, string> = {
  primary: '#2f5a70',
  secondary: COLORS.panelAlt,
  danger: '#6b2b2b',
  ghost: '#141e26',
};

const DISABLED_TINT = '#1a242c';

export interface ButtonOptions {
  text: string;
  width: number;
  height: number;
  variant?: ButtonVariant;
  /** 禁用时变灰且不注册点击（例如请求中）。 */
  disabled?: boolean;
  /** 请求中：文案替换为“处理中…”并禁用。 */
  busy?: boolean;
  fontSize?: number;
  onClick?: () => void;
}

/** 统一按钮：主/次/危险/幽灵 + 禁用/请求中态。 */
export function createButton(parent: Node, frames: PlaceholderFrames, options: ButtonOptions): Node {
  const scaleFrame = frames.white;
  const blocked = options.disabled === true || options.busy === true;
  const tint = blocked ? DISABLED_TINT : VARIANT_TINT[options.variant ?? 'secondary'];
  const node = makeNode(`button-${options.text}`, parent, options.width, options.height);
  paint(node, scaleFrame, tint);
  const label = makeLabel(node, options.busy ? '处理中…' : options.text, {
    fontSize: options.fontSize ?? FONT_SIZE.body,
    color: blocked ? '#6f8394' : COLORS.text,
  });
  place(label.node, 0, 0);

  if (!blocked) {
    const button = node.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 0.94;
    node.on(Button.EventType.CLICK, () => options.onClick?.());
  }
  return node;
}

export function createPanel(parent: Node, frames: PlaceholderFrames, width: number, height: number, tint: string = COLORS.panel): Node {
  const panel = makePanel(parent, width, height);
  paint(panel, frames.white, tint);
  return panel;
}

export interface TagOptions {
  fontSize?: number;
  height?: number;
  /** 文字颜色，默认与底色对比。 */
  textColor?: string;
}

/** 小标签：状态/模式/机器人等。宽度按字数估算，避免新增固定尺寸组件。 */
export function createTag(parent: Node, frames: PlaceholderFrames, text: string, tint: string, options: TagOptions = {}): Node {
  const fontSize = options.fontSize ?? FONT_SIZE.small;
  const height = options.height ?? fontSize + 18;
  const width = Math.max(height, Math.ceil(text.length * fontSize * 0.72) + 24);
  const node = makeNode(`tag-${text}`, parent, width, height);
  paint(node, frames.white, tint);
  const label = makeLabel(node, text, {
    fontSize,
    color: options.textColor ?? COLORS.text,
    width: width - 8,
    height,
  });
  place(label.node, 0, 0);
  return node;
}

export interface ResourceBarOptions {
  width?: number;
  /** 相对父节点的 y（默认沿用旧布局 350）。 */
  y?: number;
}

/** 资源栏：金币/食物/基因尘；数值格式化统一走 screens.formatAmount。 */
export function createResourceBar(
  parent: Node,
  profile: Profile,
  frames: PlaceholderFrames,
  options: ResourceBarOptions = {},
): Node {
  const width = options.width ?? 1200;
  const bar = makeNode('resource-bar', parent, width, 96);
  place(bar, 0, options.y ?? 350);

  const entries: Array<{ icon: SpriteFrame; value: number; label: string }> = [
    { icon: frames.iconCoin, value: profile.currencies.coin, label: '金币' },
    { icon: frames.iconFood, value: profile.currencies.food, label: '食物' },
    { icon: frames.iconGene, value: profile.currencies.geneDust, label: '基因尘' },
  ];

  const groupWidth = width / 3;
  entries.forEach((entry, index) => {
    const group = makeNode(`resource-${entry.label}`, bar, groupWidth, 96);
    place(group, (index - 1) * groupWidth, 0);
    const icon = makeSprite(
      group,
      entry.icon,
      SPRITE_SIZE.icon32 * 3,
      SPRITE_SIZE.icon32 * 3,
    );
    place(icon.node, -groupWidth / 2 + 54, 0);
    const label = makeLabel(group, `${entry.label} ${formatAmount(entry.value)}`, {
      fontSize: FONT_SIZE.body,
      color: COLORS.text,
      align: 'left',
    });
    place(label.node, 10, 0);
  });

  return bar;
}

export interface PetCardOptions {
  width?: number;
  height?: number;
  showStats?: boolean;
  onClick?: (pet: PetInstance) => void;
}

/** 宠物卡片：同尺寸占位图 + 名称/阶段/等级；点击回调由场景决定。 */
export function createPetCard(
  parent: Node,
  pet: PetInstance,
  frames: PlaceholderFrames,
  options: PetCardOptions = {},
): Node {
  const width = options.width ?? 340;
  const height = options.height ?? 460;
  const card = createPanel(parent, frames, width, height);
  card.on(Node.EventType.TOUCH_END, () => options.onClick?.(pet));

  const spriteSize = SPRITE_SIZE.pet * 3;
  const sprite = makeSprite(card, petFrame(pet.speciesId, frames), spriteSize, spriteSize, elementTint(pet.elementId));
  place(sprite.node, 0, height / 2 - spriteSize / 2 - 36);

  const name = makeLabel(card, `${petDisplayName(pet)} ${genderMark(pet.gender)}`, {
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
    const stats = makeLabel(
      card,
      `HP ${pet.genome.stats.hp}  ATK ${pet.genome.stats.atk}\nDEF ${pet.genome.stats.def}  SPD ${pet.genome.stats.spd}`,
      {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
        width: width - 24,
        height: 52,
        wrap: true,
      },
    );
    place(stats.node, 0, -196);
  }

  if (pet.habitatId !== null) {
    const badge = makeLabel(card, '栖息地中', { fontSize: FONT_SIZE.small, color: COLORS.good });
    place(badge.node, 0, height / 2 - 24);
  }

  return card;
}

/** 底部 Toast：统一位置与配色；2.5s 后由控制器的 showToast 清理 store。 */
export function renderToast(root: Node, message: string | null, frames: PlaceholderFrames): Label | null {
  if (!message) return null;
  const height = root.getComponent(UITransform)?.height ?? 1080;
  const wrapper = makeNode('toast', root, Math.min(1500, (root.getComponent(UITransform)?.width ?? 1920) - 80), 72);
  paint(wrapper, frames.white, '#0b141b');
  place(wrapper, 0, -height / 2 + 56);
  const label = makeLabel(wrapper, message, {
    fontSize: FONT_SIZE.body,
    color: COLORS.accent,
    width: wrapper.getComponent(UITransform)?.width ?? 1400,
    height: 64,
    wrap: true,
  });
  place(label.node, 0, 0);
  return label;
}

export interface ModalAction {
  text: string;
  variant?: ButtonVariant;
  onClick: () => void;
}

export interface ModalOptions {
  title: string;
  body?: string;
  width?: number;
  height?: number;
  /** 覆盖在 root 上；返回覆盖节点，调用方只需刷新即可关闭。 */
  actions: ModalAction[];
}

/** 通用弹窗：遮罩拦截穿透点击 + 标题/正文/按钮行。 */
export function showModal(root: Node, frames: PlaceholderFrames, options: ModalOptions): Node {
  const width = options.width ?? 900;
  const height = options.height ?? 460;
  const cover = makeNode('modal-cover', root, 1920, 1080);
  paint(cover, frames.white, '#05090c');
  const blocker = cover.addComponent(BlockInputEvents);
  void blocker;
  place(cover, 0, 0);

  const panel = createPanel(cover, frames, width, height);
  place(panel, 0, 0);

  const title = makeLabel(panel, options.title, { fontSize: FONT_SIZE.title, color: COLORS.text });
  place(title.node, 0, height / 2 - 70);

  if (options.body) {
    const body = makeLabel(panel, options.body, {
      fontSize: FONT_SIZE.body,
      color: COLORS.textDim,
      width: width - 120,
      height: Math.max(80, height - 260),
      wrap: true,
    });
    place(body.node, 0, 10);
  }

  const count = options.actions.length;
  const buttonWidth = Math.min(320, (width - 80) / Math.max(1, count) - 24);
  options.actions.forEach((action, index) => {
    const x = (index - (count - 1) / 2) * (buttonWidth + 32);
    const button = createButton(panel, frames, {
      text: action.text,
      width: buttonWidth,
      height: 80,
      variant: action.variant,
      onClick: action.onClick,
    });
    place(button, x, -height / 2 + 72);
  });

  return cover;
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function showConfirm(root: Node, frames: PlaceholderFrames, options: ConfirmOptions): Node {
  return showModal(root, frames, {
    title: options.title,
    body: options.body,
    actions: [
      { text: options.cancelText ?? '取消', variant: 'secondary', onClick: options.onCancel },
      {
        text: options.confirmText ?? '确认',
        variant: options.danger ? 'danger' : 'primary',
        onClick: options.onConfirm,
      },
    ],
  });
}

/** 清空节点并释放子节点（供分页/虚拟列表局部刷新使用）。 */
export function resetNode(node: Node): void {
  clearChildren(node);
}
