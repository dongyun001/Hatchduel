import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { loadPvpDefense, savePvpDefense } from '../services/pvpActions';
import { nowMs } from '../services/bootstrap';
import type { ApiErrorCode, PvpDefenseInfo } from '../../lib/protocol';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel, createTag, renderToast } from '../ui/kit';
import { createEmptyState, createErrorState, createLoadingState } from '../ui/states';
import { createLineupPicker } from '../ui/lineupEditor';
import { makeLabel, place } from '../ui/nodes';
import { createTitle } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

type Phase = 'loading' | 'ready' | 'error';

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function hoursLeft(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '已过期';
  return `约 ${Math.ceil(ms / (60 * 60 * 1000))} 小时`;
}

/**
 * M2-02 防守设置：1~3 只非蛋宠物，展示快照时间与 24h 有效期；
 * stale 提示重新设置；保存走 POST /pvp/defense（mock 走本地快照）。
 */
@ccclass('PvpDefenseController')
export class PvpDefenseController extends Component {
  private view: SceneView | null = null;
  private phase: Phase = 'loading';
  private info: PvpDefenseInfo | null = null;
  private selected: string[] = [];
  private busy = false;
  private error: { code?: ApiErrorCode; message: string } | null = null;
  private listOffset = 0;
  private initialised = false;

  start(): void {
    this.view = new SceneView(this, 'pvpdefense-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init().then(() => this.load());
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private async load(): Promise<void> {
    this.phase = 'loading';
    this.view?.refresh();
    const result = await loadPvpDefense();
    if (!result.ok) {
      this.phase = 'error';
      this.error = { code: result.code, message: result.message };
      this.view?.refresh();
      return;
    }
    this.info = result.data?.defense ?? null;
    if (!this.initialised) {
      this.initialised = true;
      const profile = appStore.getState().profile;
      const allowed = new Set(
        Object.values(profile?.pets ?? {})
          .filter((pet) => pet.stage !== 'egg')
          .map((pet) => pet.id),
      );
      const fromDefense = (this.info?.petIds ?? profile?.pvp.defense ?? []).filter((id) => allowed.has(id));
      this.selected = fromDefense.slice(0, 3);
    }
    this.phase = 'ready';
    this.view?.refresh();
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, 'PvP 防守阵容');
    place(title.node, 0, 440);

    const back = createButton(root, frames, {
      text: '返回主页',
      width: 260,
      height: 72,
      variant: 'secondary',
      onClick: () => gotoScene('home'),
    });
    place(back, -800, 440);

    if (this.phase === 'loading') {
      const loading = createLoadingState(root, frames, { text: '正在读取防守快照…' });
      place(loading, 0, 0);
      return;
    }

    if (this.phase === 'error') {
      const error = createErrorState(root, frames, {
        code: this.error?.code,
        message: this.error?.message ?? '加载失败',
        onRetry: () => void this.load(),
        onBack: () => gotoScene('home'),
      });
      place(error, 0, 0);
      return;
    }

    const profile = state.profile;
    if (!profile) {
      const error = createErrorState(root, frames, { message: '没有存档', onBack: () => gotoScene('home') });
      place(error, 0, 0);
      return;
    }

    const pets = Object.values(profile.pets)
      .filter((pet) => pet.stage !== 'egg')
      .sort((a, b) => b.level - a.level);

    if (pets.length === 0) {
      const empty = createEmptyState(root, frames, {
        text: '没有可上防守的宠物（蛋不能进防守）',
        actionText: '去宠物列表',
        onAction: () => gotoScene('petList'),
      });
      place(empty, 0, 0);
      renderToast(root, state.ui.toast, frames);
      return;
    }

    this.renderSnapshotInfo(root, frames);

    const picker = createLineupPicker(root, {
      width: 1500,
      height: 470,
      pets,
      selected: this.selected,
      frames,
      title: '选择防守宠物（1~3 只，顺序即出场顺序）',
      max: 3,
      min: 1,
      initialOffset: this.listOffset,
      onOffsetChange: (offset) => {
        this.listOffset = offset;
      },
      onChange: (ids) => {
        this.selected = ids;
      },
    });
    place(picker.node, 0, -90);

    const save = createButton(root, frames, {
      text: '保存防守阵容',
      width: 360,
      height: 80,
      variant: 'primary',
      busy: this.busy,
      onClick: () => void this.save(),
    });
    place(save, 380, -440);

    const hint = makeLabel(root, '防守快照 24h 有效；过期仍会被匹配，建议重新设置。防守中的宠物不可放生（PET_IN_USE）。', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      width: 800,
      wrap: true,
    });
    place(hint.node, -420, -440);

    renderToast(root, state.ui.toast, frames);
  }

  private renderSnapshotInfo(root: Node, frames: PlaceholderFrames): void {
    const panel = createPanel(root, frames, 1500, 120, COLORS.panelAlt);
    place(panel, 0, 300);

    const now = nowMs() + appStore.getState().remote.serverTimeOffsetMs;
    const info = this.info;
    const status = info ? (info.stale ? '已过期' : '已设置') : '未设置';
    const tag = createTag(panel, frames, status, info && !info.stale ? COLORS.good : info ? COLORS.accent : '#2b3d49', {
      fontSize: FONT_SIZE.small,
    });
    place(tag, -640, 0);

    const text = info
      ? `宠物 ${info.petIds.length} 只 · 快照 ${formatTime(info.createdAt)} · 到期 ${formatTime(info.expiresAt)}（${hoursLeft(info.expiresAt, now)}）· 版本 ${info.contentVersion}`
      : '尚未设置防守阵容。不设置会被其他玩家匹配到空阵容（服务端会拒绝）。';
    const label = makeLabel(panel, text, {
      fontSize: FONT_SIZE.body,
      color: info?.stale ? COLORS.accent : COLORS.text,
      align: 'left',
      width: 1300,
      wrap: true,
    });
    place(label.node, 90, 12);

    if (info?.stale) {
      const stale = makeLabel(panel, '快照已超过 24h：仍作为对战输入，但建议重新保存。', {
        fontSize: FONT_SIZE.small,
        color: COLORS.accent,
        align: 'left',
        width: 1300,
      });
      place(stale.node, 90, -30);
    }
  }

  private async save(): Promise<void> {
    if (this.busy) return;
    if (this.selected.length === 0) {
      this.view?.showToast('至少选择 1 只防守宠物');
      return;
    }
    this.busy = true;
    this.view?.refresh();
    const result = await savePvpDefense(this.selected);
    this.busy = false;
    if (result.ok) {
      this.info = result.info ?? this.info;
      this.error = null;
      this.view?.showToast(result.message);
    } else {
      this.error = { code: result.code, message: result.message };
      this.view?.showToast(result.message);
    }
    this.view?.refresh();
  }
}
