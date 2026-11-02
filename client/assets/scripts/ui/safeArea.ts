import { Rect, sys, view, type Node } from 'cc';
import { makeNode, place } from './nodes';
import { DESIGN } from './theme';

/**
 * 安全区（UI-03 / ART_SPEC §1 适配）。
 *
 * `sys.getSafeAreaRect()` 返回**设计分辨率**坐标下的可视安全矩形（微信/原生支持；
 * Web/编辑器无刘海时等于 visibleSize）。所有页面通过 `SceneView` 在安全区内渲染，
 * 背景仍铺满整屏，避免刘海/圆角/底部手势区遮挡交互。
 */
export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SafeAreaLayout {
  /** 相对 Canvas 中心的位置。 */
  x: number;
  y: number;
  width: number;
  height: number;
  insets: SafeInsets;
}

function readSafeRect(): Rect {
  try {
    const rect = sys.getSafeAreaRect();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
  } catch {
    // 某些平台/预览环境未实现：退化为整屏。
  }
  const visible = view.getVisibleSize();
  if (!visible || visible.width <= 0 || visible.height <= 0) {
    return new Rect(0, 0, DESIGN.width, DESIGN.height);
  }
  return new Rect(0, 0, visible.width, visible.height);
}

export function getSafeAreaLayout(): SafeAreaLayout {
  const raw = view.getVisibleSize();
  const visible = {
    width: raw && raw.width > 0 ? raw.width : DESIGN.width,
    height: raw && raw.height > 0 ? raw.height : DESIGN.height,
  };
  const rect = readSafeRect();
  const insets: SafeInsets = {
    left: Math.max(0, rect.x),
    right: Math.max(0, visible.width - (rect.x + rect.width)),
    bottom: Math.max(0, rect.y),
    top: Math.max(0, visible.height - (rect.y + rect.height)),
  };
  return {
    x: rect.x + rect.width / 2 - visible.width / 2,
    y: rect.y + rect.height / 2 - visible.height / 2,
    width: rect.width,
    height: rect.height,
    insets,
  };
}

export function getSafeInsets(): SafeInsets {
  return getSafeAreaLayout().insets;
}

/** 在整屏 root 下建一个安全区容器；页面内容放进它，背景不放进它。 */
export function createSafeArea(parent: Node, name = 'safe-area'): Node {
  const layout = getSafeAreaLayout();
  const node = makeNode(name, parent, layout.width, layout.height);
  place(node, layout.x, layout.y);
  return node;
}
