import { type Node, UITransform } from 'cc';
import type { ApiErrorCode } from '../../lib/protocol';
import { apiErrorText } from '../services/errors';
import { createButton, createPanel, createTag } from './kit';
import { makeLabel, makeNode, place } from './nodes';
import type { PlaceholderFrames } from './placeholders';
import { COLORS, FONT_SIZE } from './theme';

/**
 * 三态统一（UI-02）：Loading / Empty / Error。
 * - Loading 用于异步请求中；
 * - Empty 用于请求成功但没有数据；
 * - Error 显示错误码文案 + 重试按钮，错误码统一走 `services/errors.ts`。
 */

function centerOf(root: Node): { width: number; height: number } {
  const transform = root.getComponent(UITransform);
  return { width: transform?.width ?? 1920, height: transform?.height ?? 1080 };
}

export interface LoadingStateOptions {
  text?: string;
  /** 显示一个静态进度条，避免“页面像卡死”。 */
  showBar?: boolean;
}

export function createLoadingState(root: Node, frames: PlaceholderFrames, options: LoadingStateOptions = {}): Node {
  const { width } = centerOf(root);
  const panel = makeNode('state-loading', root, width, 260);
  place(panel, 0, 0);

  const tag = createTag(panel, frames, 'LOADING', '#274253', { height: 38 });
  place(tag, 0, 74);

  const label = makeLabel(panel, options.text ?? '加载中…', {
    fontSize: FONT_SIZE.heading,
    color: COLORS.text,
    width: width - 120,
    height: 60,
    wrap: true,
  });
  place(label.node, 0, 16);

  if (options.showBar !== false) {
    const track = createPanel(panel, frames, 520, 12, '#16232c');
    place(track, 0, -56);
    const fill = createPanel(track, frames, 260, 12, COLORS.accent);
    place(fill, -130, 0);
  }
  return panel;
}

export interface EmptyStateOptions {
  text?: string;
  actionText?: string;
  onAction?: () => void;
}

export function createEmptyState(root: Node, frames: PlaceholderFrames, options: EmptyStateOptions = {}): Node {
  const { width } = centerOf(root);
  const panel = makeNode('state-empty', root, width, 300);
  place(panel, 0, 0);

  const tag = createTag(panel, frames, 'EMPTY', '#3c3520', { height: 38 });
  place(tag, 0, 86);

  const label = makeLabel(panel, options.text ?? '这里还没有内容', {
    fontSize: FONT_SIZE.heading,
    color: COLORS.textDim,
    width: Math.min(1200, width - 120),
    height: 96,
    wrap: true,
  });
  place(label.node, 0, 20);

  if (options.actionText && options.onAction) {
    const button = createButton(panel, frames, {
      text: options.actionText,
      width: 320,
      height: 76,
      variant: 'primary',
      onClick: options.onAction,
    });
    place(button, 0, -80);
  }
  return panel;
}

export interface ErrorStateOptions {
  code?: ApiErrorCode;
  message?: string;
  retryText?: string;
  onRetry?: () => void;
  /** 额外操作（例如返回主页）。 */
  backText?: string;
  onBack?: () => void;
}

export function createErrorState(root: Node, frames: PlaceholderFrames, options: ErrorStateOptions = {}): Node {
  const { width } = centerOf(root);
  const panel = makeNode('state-error', root, width, 360);
  place(panel, 0, 0);

  const tag = createTag(panel, frames, 'ERROR', '#5a2020', { height: 38 });
  place(tag, 0, 116);

  const title = makeLabel(panel, apiErrorText(options.code), {
    fontSize: FONT_SIZE.heading,
    color: COLORS.danger,
    width: Math.min(1400, width - 120),
    height: 56,
    wrap: true,
  });
  place(title.node, 0, 52);

  const detail = options.message ?? (options.code ? `错误码：${options.code}` : '请稍后重试');
  const label = makeLabel(panel, detail, {
    fontSize: FONT_SIZE.body,
    color: COLORS.textDim,
    width: Math.min(1200, width - 120),
    height: 96,
    wrap: true,
  });
  place(label.node, 0, -18);

  const actions: Array<{ text: string; onClick: () => void; variant: 'primary' | 'secondary' }> = [];
  if (options.onBack) actions.push({ text: options.backText ?? '返回', onClick: options.onBack, variant: 'secondary' });
  if (options.onRetry) actions.push({ text: options.retryText ?? '重试', onClick: options.onRetry, variant: 'primary' });

  actions.forEach((action, index) => {
    const button = createButton(panel, frames, {
      text: action.text,
      width: 300,
      height: 80,
      variant: action.variant,
      onClick: action.onClick,
    });
    place(button, (index - (actions.length - 1) / 2) * 340, -120);
  });
  return panel;
}
