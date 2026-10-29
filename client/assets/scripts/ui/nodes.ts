import { Button, Color, Label, Node, Sprite, UITransform, type SpriteFrame } from 'cc';
import { COLORS, FONT_SIZE } from './theme';

/** 运行时创建 UI 节点的公共工具；所有节点继承父节点 layer（Canvas 的 UI_2D）。 */
export function hexColor(hex: string): Color {
  return new Color().fromHEX(hex);
}

export function place(node: Node, x: number, y: number): void {
  node.setPosition(x, y, 0);
}

export function makeNode(name: string, parent: Node, width = 0, height = 0): Node {
  const node = new Node(name);
  node.layer = parent.layer;
  parent.addChild(node);
  const transform = node.addComponent(UITransform);
  if (width > 0 && height > 0) transform.setContentSize(width, height);
  return node;
}

export function makeSprite(
  parent: Node,
  frame: SpriteFrame,
  width: number,
  height: number,
  tintHex?: string,
): Sprite {
  const node = makeNode(`sprite-${frame.name}`, parent, width, height);
  const sprite = node.addComponent(Sprite);
  // 先设 CUSTOM 再赋帧，否则 Sprite 会把节点尺寸重置为贴图原始尺寸。
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  sprite.type = Sprite.Type.SIMPLE;
  sprite.spriteFrame = frame;
  node.getComponent(UITransform)?.setContentSize(width, height);
  if (tintHex) sprite.color = hexColor(tintHex);
  return sprite;
}

export interface LabelOptions {
  fontSize?: number;
  color?: string;
  width?: number;
  height?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
}

export function makeLabel(parent: Node, text: string, options: LabelOptions = {}): Label {
  const fontSize = options.fontSize ?? FONT_SIZE.body;
  const lineHeight = Math.round(fontSize * 1.25);
  const node = makeNode('label', parent, options.width ?? 0, options.height ?? 0);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = lineHeight;
  label.color = hexColor(options.color ?? COLORS.text);
  label.horizontalAlign =
    options.align === 'left'
      ? Label.HorizontalAlign.LEFT
      : options.align === 'right'
        ? Label.HorizontalAlign.RIGHT
        : Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  if (options.width && options.wrap) {
    // 只给宽度时节点高度会被 makeNode 跳过，CLAMP 会按 0 宽逐字折行。
    node.getComponent(UITransform)?.setContentSize(options.width, options.height ?? lineHeight * 2);
    label.overflow = Label.Overflow.CLAMP;
    label.enableWrapText = true;
  } else {
    label.overflow = Label.Overflow.NONE;
  }
  return label;
}

export function makePanel(parent: Node, width: number, height: number): Node {
  return makeNode('panel', parent, width, height);
}

export function makeButton(
  parent: Node,
  text: string,
  width: number,
  height: number,
  frame: SpriteFrame,
  onClick: () => void,
  tintHex: string = COLORS.panelAlt,
): Node {
  const node = makeNode(`button-${text}`, parent, width, height);
  paint(node, frame, tintHex);
  const label = makeLabel(node, text, { fontSize: FONT_SIZE.body, color: COLORS.text });
  label.node.setPosition(0, 0, 0);
  const button = node.addComponent(Button);
  button.transition = Button.Transition.SCALE;
  button.zoomScale = 0.94;
  node.on(Button.EventType.CLICK, onClick);
  return node;
}

/**
 * 用纯色 sprite 铺底：先占位再替换成 white 帧。
 * 在这里统一挂 SpriteFrame，避免每个 controller 重复处理。
 */
export function paint(node: Node, frame: SpriteFrame, tintHex: string): Sprite {
  const transform = node.getComponent(UITransform);
  const width = transform?.width ?? 0;
  const height = transform?.height ?? 0;
  const sprite = node.getComponent(Sprite) ?? node.addComponent(Sprite);
  // 同上：先设 CUSTOM 再赋帧，赋帧后恢复节点尺寸。
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  sprite.type = Sprite.Type.SIMPLE;
  sprite.spriteFrame = frame;
  if (width > 0 && height > 0) transform?.setContentSize(width, height);
  sprite.color = hexColor(tintHex);
  return sprite;
}

export function clearChildren(node: Node): void {
  for (const child of [...node.children]) child.destroy();
}
