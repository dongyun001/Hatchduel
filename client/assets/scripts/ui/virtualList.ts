import { Color, EventTouch, Node, UITransform, Vec3 } from 'cc';
import { makeNode, paint, place } from './nodes';
import type { PlaceholderFrames } from './placeholders';

/**
 * 轻量虚拟列表（UI-05）：只实例化视口内的行，节点数不随条目总数增长。
 *
 * 没有用 ScrollView + Mask：行本身不接触摸，最上层放一个透明的触摸层统一处理
 * 拖动与点击，这样 40+ 条时也只有约 7~9 个行节点，且拖动不会因为行被回收而中断。
 */
export interface VirtualListOptions<T> {
  width: number;
  height: number;
  rowHeight: number;
  gap?: number;
  items: readonly T[];
  initialOffset?: number;
  renderRow: (item: T, index: number, row: Node, width: number) => void;
  onSelect?: (item: T, index: number) => void;
  onOffsetChange?: (offset: number) => void;
}

export interface VirtualListHandle<T> {
  node: Node;
  setItems(items: readonly T[]): void;
  getOffset(): number;
  setOffset(offset: number): void;
  scrollBy(delta: number): void;
  refresh(): void;
  maxOffset(): number;
}

const DRAG_THRESHOLD = 8;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function createVirtualList<T>(
  parent: Node,
  frames: PlaceholderFrames,
  options: VirtualListOptions<T>,
): VirtualListHandle<T> {
  const gap = options.gap ?? 8;
  const step = options.rowHeight + gap;
  const viewport = makeNode('virtual-list', parent, options.width, options.height);
  const content = makeNode('virtual-content', viewport, options.width, options.height);
  const rows = new Map<number, Node>();
  let items = options.items;
  let offset = Math.max(0, options.initialOffset ?? 0);
  let dragging = false;
  let moved = 0;

  const maxOffset = (): number => Math.max(0, items.length * step - gap - options.height);

  const ensureRow = (index: number): Node => {
    const existing = rows.get(index);
    if (existing) return existing;
    const row = makeNode(`virtual-row-${index}`, content, options.width, options.rowHeight);
    options.renderRow(items[index], index, row, options.width);
    rows.set(index, row);
    return row;
  };

  const layout = (): void => {
    offset = clamp(offset, 0, maxOffset());
    const first = Math.max(0, Math.floor(offset / step));
    // 只实例化完整落在视口内的行；否则最后一行会画到视口外，压住底部提示。
    const last = Math.min(
      items.length - 1,
      Math.floor((offset + options.height - options.rowHeight) / step),
    );

    for (const [index, row] of rows) {
      if (index < first - 1 || index > last + 1) {
        row.destroy();
        rows.delete(index);
      }
    }
    for (let index = first; index <= last; index += 1) {
      const row = ensureRow(index);
      const y = options.height / 2 - options.rowHeight / 2 - (index * step - offset);
      place(row, 0, y);
    }
    options.onOffsetChange?.(offset);
  };

  // 透明触摸层：统一处理拖动与点击；放在 content 之后，始终位于行上方。
  const overlay = makeNode('virtual-list-touch', viewport, options.width, options.height);
  const overlaySprite = paint(overlay, frames.white, '#000000');
  overlaySprite.color = new Color(0, 0, 0, 1);
  place(overlay, 0, 0);

  const localY = (event: EventTouch): number => {
    const location = event.getUILocation();
    const transform = overlay.getComponent(UITransform);
    if (!transform) return 0;
    return transform.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0)).y;
  };

  const finish = (event: EventTouch | null): void => {
    if (!dragging) return;
    dragging = false;
    if (moved < DRAG_THRESHOLD && event) {
      const y = localY(event);
      const index = Math.floor((options.height / 2 - y + offset) / step);
      if (index >= 0 && index < items.length) options.onSelect?.(items[index], index);
    }
  };

  overlay.on(Node.EventType.TOUCH_START, () => {
    dragging = true;
    moved = 0;
  });
  overlay.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
    if (!dragging) return;
    const delta = event.getUIDelta().y;
    moved += Math.abs(delta);
    if (moved >= DRAG_THRESHOLD) {
      offset = clamp(offset + delta, 0, maxOffset());
      layout();
    }
  });
  overlay.on(Node.EventType.TOUCH_END, (event: EventTouch) => finish(event));
  overlay.on(Node.EventType.TOUCH_CANCEL, () => finish(null));

  layout();

  return {
    node: viewport,
    setItems(next: readonly T[]): void {
      items = next;
      layout();
    },
    getOffset: () => offset,
    setOffset(next: number): void {
      offset = clamp(next, 0, maxOffset());
      layout();
    },
    scrollBy(delta: number): void {
      offset = clamp(offset + delta, 0, maxOffset());
      layout();
    },
    refresh(): void {
      for (const row of rows.values()) row.destroy();
      rows.clear();
      layout();
    },
    maxOffset,
  };
}
