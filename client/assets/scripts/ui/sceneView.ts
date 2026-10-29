import type { Component, Node } from 'cc';
import { appStore } from '../app/store';
import type { AppState } from '../app/store';
import { clearChildren, makeNode } from './nodes';
import { preloadPlaceholders } from './placeholders';
import type { PlaceholderFrames } from './placeholders';
import { createBackground } from './screens';
import { DESIGN } from './theme';

export type SceneRenderFn = (root: Node, frames: PlaceholderFrames, state: Readonly<AppState>) => void;

/**
 * 场景公共壳：预加载占位图、建根节点、订阅 store、整树重绘 + toast。
 * 控制器只写 render 函数，不直接碰 store 订阅/清理逻辑。
 */
export class SceneView {
  private root: Node | null = null;
  private frames: PlaceholderFrames | null = null;
  private unsubscribe: (() => void) | null = null;
  private renderQueued = false;

  constructor(
    private readonly host: Component,
    private readonly rootName: string,
    private readonly renderFn: SceneRenderFn,
  ) {}

  async init(): Promise<void> {
    this.frames = await preloadPlaceholders();
    this.root = makeNode(this.rootName, this.host.node, DESIGN.width, DESIGN.height);
    this.unsubscribe = appStore.subscribe(() => this.queueRender());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** 仅 UI 本状态变化（如繁殖双亲选择）时手动重绘。 */
  refresh(): void {
    this.queueRender();
  }

  showToast(message: string): void {
    appStore.setToast(message);
    this.host.unschedule(this.clearToast);
    this.host.scheduleOnce(this.clearToast, 2.5);
  }

  private clearToast = (): void => {
    appStore.setToast(null);
  };

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.host.scheduleOnce(() => {
      this.renderQueued = false;
      this.render();
    }, 0);
  }

  private render(): void {
    const root = this.root;
    const frames = this.frames;
    if (!root || !root.isValid || !frames) return;
    const state = appStore.getState();
    clearChildren(root);
    createBackground(root, frames);
    this.renderFn(root, frames, state);
  }
}
