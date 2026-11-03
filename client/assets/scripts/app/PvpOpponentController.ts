import { _decorator, BlockInputEvents, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { fightPvp, loadPvpOpponent } from '../services/pvpActions';
import { saveLineup } from '../services/battleActions';
import { getConfigRepo } from '../services/config';
import { nowMs } from '../services/bootstrap';
import type { ApiErrorCode, GetPvpOpponentResponse } from '../../lib/protocol';
import type { PetInstance } from '../../lib/core';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel, createTag, renderToast } from '../ui/kit';
import { createEmptyState, createErrorState, createLoadingState } from '../ui/states';
import { createLineupPicker } from '../ui/lineupEditor';
import { makeLabel, makeNode, paint, place } from '../ui/nodes';
import { createTitle, petDisplayName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

type Phase = 'loading' | 'ready' | 'error';

/**
 * M2-03 对手/匹配：名称、段位、物种预览、平均等级、isBot 标记、剩余次数、刷新。
 * 开始挑战会消耗次数；请求中禁用重复点击；失败分支写入 store 后由结果页展示。
 */
@ccclass('PvpOpponentController')
export class PvpOpponentController extends Component {
  private view: SceneView | null = null;
  private phase: Phase = 'loading';
  private data: GetPvpOpponentResponse | null = null;
  private error: { code?: ApiErrorCode; message: string } | null = null;
  private busy = false;
  private lineupBusy = false;
  private lineupOpen = false;
  private lineupSelected: string[] = [];
  private lineupOffset = 0;
  private initialisedLineup = false;

  start(): void {
    this.view = new SceneView(this, 'pvpopponent-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init().then(() => this.load());
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private async load(): Promise<void> {
    this.phase = 'loading';
    this.error = null;
    this.view?.refresh();
    const result = await loadPvpOpponent();
    if (!result.ok || !result.data) {
      this.phase = 'error';
      this.error = { code: result.code, message: result.message };
      this.view?.refresh();
      return;
    }
    this.data = result.data;
    this.phase = 'ready';
    appStore.setPvpOverview({
      challengesRemaining: result.data.challengesRemaining,
      dailyLimit: result.data.dailyLimit,
      seasonId: result.data.seasonId,
      loading: false,
      error: null,
      loadedAt: nowMs(),
    });
    this.view?.refresh();
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, 'PvP 匹配');
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
      const loading = createLoadingState(root, frames, { text: '正在匹配对手…' });
      place(loading, 0, 0);
      return;
    }

    if (this.phase === 'error') {
      const error = createErrorState(root, frames, {
        code: this.error?.code,
        message: this.error?.message ?? '匹配失败',
        retryText: '重新匹配',
        onRetry: () => void this.load(),
        onBack: () => gotoScene('home'),
      });
      place(error, 0, 0);
      return;
    }

    const profile = state.profile;
    if (!profile || !this.data) {
      const empty = createEmptyState(root, frames, {
        text: '没有可用的匹配数据',
        actionText: '重新匹配',
        onAction: () => void this.load(),
      });
      place(empty, 0, 0);
      return;
    }

    this.renderStatus(root, frames, this.data);
    this.renderOpponent(root, frames, this.data);

    const lineupMissing = profile.lineup.length === 0;
    const canFight = this.data.challengesRemaining > 0 && !lineupMissing && !this.busy;
    const refresh = createButton(root, frames, {
      text: '刷新对手',
      width: 320,
      height: 84,
      variant: 'secondary',
      disabled: this.busy,
      onClick: () => void this.load(),
    });
    place(refresh, -520, -330);

    const fight = createButton(root, frames, {
      text: lineupMissing ? '先设置出战编队' : canFight ? '开始挑战' : '今日次数已用完',
      width: 420,
      height: 92,
      variant: 'primary',
      disabled: this.busy || (!lineupMissing && this.data.challengesRemaining <= 0),
      busy: this.busy,
      onClick: () => {
        if (lineupMissing) {
          this.openLineup();
          return;
        }
        void this.fight();
      },
    });
    place(fight, 0, -330);

    const lineup = createButton(root, frames, {
      text: '更换出战编队',
      width: 320,
      height: 84,
      variant: 'secondary',
      disabled: this.busy,
      onClick: () => {
        this.openLineup();
      },
    });
    place(lineup, 520, -330);

    const hint = makeLabel(root, '匹配不消耗次数；fight 成功才扣 1 次。机器人不计榜、不改段位。', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(hint.node, 0, -420);

    if (this.lineupOpen) this.renderLineupOverlay(root, frames, profile);

    renderToast(root, state.ui.toast, frames);
  }

  private renderStatus(root: Node, frames: PlaceholderFrames, data: GetPvpOpponentResponse): void {
    const panel = createPanel(root, frames, 1500, 80, COLORS.panelAlt);
    place(panel, 0, 340);
    const text = `今日剩余 ${data.challengesRemaining}/${data.dailyLimit} 次 · 赛季 ${data.seasonId} · 匹配不消耗次数`;
    const label = makeLabel(panel, text, {
      fontSize: FONT_SIZE.body,
      color: data.challengesRemaining > 0 ? COLORS.text : COLORS.danger,
      align: 'left',
      width: 1400,
    });
    place(label.node, 0, 0);
  }

  private renderOpponent(root: Node, frames: PlaceholderFrames, data: GetPvpOpponentResponse): void {
    const opponent = data.opponent;
    const panel = createPanel(root, frames, 1400, 430, COLORS.panel);
    place(panel, 0, 80);

    const name = makeLabel(panel, opponent.displayName, {
      fontSize: 42,
      color: COLORS.text,
      align: 'left',
      width: 900,
    });
    place(name.node, -200, 130);

    if (opponent.isBot) {
      const tag = createTag(panel, frames, '机器人', COLORS.accent);
      place(tag, 520, 130);
    } else {
      const tag = createTag(panel, frames, '真人', COLORS.good);
      place(tag, 520, 130);
    }

    const rating = makeLabel(panel, `段位 ${opponent.rating}`, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.accent,
    });
    place(rating.node, -200, 60);

    const meta = makeLabel(panel, `平均等级 Lv.${opponent.avgLevel} · 出战 ${opponent.petCount} 只`, {
      fontSize: FONT_SIZE.body,
      color: COLORS.textDim,
    });
    place(meta.node, -200, 10);

    const previewTitle = makeLabel(panel, '物种预览', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      align: 'left',
      width: 1200,
    });
    place(previewTitle.node, 0, -70);

    const cfg = getConfigRepo();
    const width = Math.min(260, 1100 / Math.max(1, opponent.speciesPreview.length));
    opponent.speciesPreview.forEach((speciesId, index) => {
      let label = speciesId;
      try {
        label = cfg.species(speciesId).name;
      } catch {
        // 配置缺失时回退 id，避免整页因单个物种渲染失败。
      }
      const tile = createPanel(panel, frames, width - 20, 120, '#1f3644');
      place(tile, (index - (opponent.speciesPreview.length - 1) / 2) * width, -160);
      const nameLabel = makeLabel(tile, label, { fontSize: FONT_SIZE.body, color: COLORS.text });
      place(nameLabel.node, 0, 12);
      const elementLabel = makeLabel(tile, `平均 Lv.${opponent.avgLevel}`, {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
      });
      place(elementLabel.node, 0, -34);
    });

    const note = opponent.isBot
      ? '训练师机器人：不计榜、不改段位；用于冷启动匹配。'
      : `对手段位 ${opponent.rating}；结算后双方 rating 会变化。`;
    const noteLabel = makeLabel(panel, note, {
      fontSize: FONT_SIZE.small,
      color: opponent.isBot ? COLORS.accent : COLORS.textDim,
      width: 1300,
      wrap: true,
    });
    place(noteLabel.node, 0, -245);
  }

  private openLineup(): void {
    const profile = appStore.getState().profile;
    if (!profile) return;
    if (!this.initialisedLineup) {
      this.initialisedLineup = true;
      const allowed = new Set(Object.values(profile.pets).filter((pet) => pet.stage !== 'egg').map((pet) => pet.id));
      const preferred = profile.lineup.filter((id) => allowed.has(id)).slice(0, 3);
      this.lineupSelected = preferred.length > 0 ? preferred : Array.from(allowed).slice(0, 3);
    }
    this.lineupOpen = true;
    this.view?.refresh();
  }

  private renderLineupOverlay(root: Node, frames: PlaceholderFrames, profile: NonNullable<AppState['profile']>): void {
    const cover = makeNode('lineup-cover', root, 1920, 1080);
    paint(cover, frames.white, '#05090c');
    cover.addComponent(BlockInputEvents);
    place(cover, 0, 0);

    const panel = createPanel(cover, frames, 1540, 820, COLORS.panel);
    const title = makeLabel(panel, '更换出战编队（1~3 只，非蛋）', {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
    });
    place(title.node, 0, 360);

    const pets: PetInstance[] = Object.values(profile.pets)
      .filter((pet) => pet.stage !== 'egg')
      .sort((a, b) => b.level - a.level);

    const picker = createLineupPicker(panel, {
      width: 1440,
      height: 590,
      pets,
      selected: this.lineupSelected,
      frames,
      title: '出战宠物',
      max: 3,
      min: 1,
      initialOffset: this.lineupOffset,
      onOffsetChange: (offset) => {
        this.lineupOffset = offset;
      },
      onChange: (ids) => {
        this.lineupSelected = ids;
      },
    });
    place(picker.node, 0, 10);

    const cancel = createButton(panel, frames, {
      text: '取消',
      width: 260,
      height: 76,
      variant: 'secondary',
      onClick: () => {
        this.lineupOpen = false;
        this.view?.refresh();
      },
    });
    place(cancel, -180, -350);

    const save = createButton(panel, frames, {
      text: '保存编队',
      width: 260,
      height: 76,
      variant: 'primary',
      busy: this.lineupBusy,
      onClick: () => void this.saveLineup(),
    });
    place(save, 180, -350);

    const selectedNames = this.lineupSelected
      .map((id) => {
        const pet = profile.pets[id];
        return pet ? petDisplayName(pet) : id;
      })
      .join(' / ');
    const selectedLabel = makeLabel(panel, selectedNames, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      width: 1300,
      wrap: true,
    });
    place(selectedLabel.node, 0, -300);
  }

  private async saveLineup(): Promise<void> {
    if (this.lineupBusy) return;
    this.lineupBusy = true;
    this.view?.refresh();
    const result = await saveLineup(this.lineupSelected);
    this.lineupBusy = false;
    this.view?.showToast(result.message);
    if (result.ok) {
      this.lineupOpen = false;
    }
    this.view?.refresh();
  }

  private async fight(): Promise<void> {
    if (this.busy || !this.data) return;
    if (this.data.challengesRemaining <= 0) {
      this.view?.showToast('今日 PvP 次数已用完');
      return;
    }
    this.busy = true;
    this.view?.refresh();
    const result = await fightPvp(this.data.opponent);
    this.busy = false;
    if (result.ok) {
      gotoScene('pvpResult');
    } else {
      // 失败分支（429/409/410/校验）由结果页按错误码展示。
      gotoScene('pvpResult');
    }
  }
}
