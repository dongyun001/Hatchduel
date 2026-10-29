import { _decorator, Component, profiler, type Label, type Node } from 'cc';
import { gotoScene } from './navigation';
import { bootstrapApp } from '../services/bootstrap';
import { hexColor, makeLabel, makeNode, makePanel, paint, place } from '../ui/nodes';
import { preloadPlaceholders } from '../ui/placeholders';
import { COLORS, DESIGN, FONT_SIZE } from '../ui/theme';

const { ccclass } = _decorator;

/**
 * Boot：初始化平台适配器、mock/服务端存档，预加载占位图，然后进 Home。
 *
 * 设计分辨率 1920×1080（640×360 × 3）由工程设置 settings/v2/packages/project.json 驱动；
 * 不要在这里再调 `view.setDesignResolutionSize`——它会在 Canvas 初始化前触发一次
 * `design-resolution-changed`，导致 Camera.orthoHeight 用到旧的窗口尺寸（实测 810 而不是 540）。
 */
@ccclass('BootController')
export class BootController extends Component {
  private status: Label | null = null;

  start(): void {
    // 调试构建默认显示 FPS 面板，会挡住左下角按钮；游戏内不需要，先关掉（需要时临时打开）。
    profiler.hideStats();

    const root = makeNode('boot-root', this.node, DESIGN.width, DESIGN.height);
    const title = makeLabel(root, '宠物对决', { fontSize: FONT_SIZE.title, color: COLORS.text });
    place(title.node, 0, 80);
    const subtitle = makeLabel(root, 'PetBattle', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
    place(subtitle.node, 0, 20);
    this.status = makeLabel(root, '初始化中…', { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(this.status.node, 0, -60);

    void this.run(root);
  }

  private async run(root: Node): Promise<void> {
    try {
      const result = await bootstrapApp();
      if (this.status) this.status.string = `平台 ${result.platform.kind} · 模式 ${result.mode}`;
      const frames = await preloadPlaceholders();
      const bg = makePanel(root, DESIGN.width, DESIGN.height);
      paint(bg, frames.white, COLORS.bg);
      place(bg, 0, 0);
      bg.setSiblingIndex(0);
      await this.delay(0.4);
      gotoScene('home');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.status) {
        this.status.string = `启动失败：${message}`;
        this.status.color = hexColor(COLORS.danger);
      }
    }
  }

  private delay(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.scheduleOnce(() => resolve(), seconds);
    });
  }
}
