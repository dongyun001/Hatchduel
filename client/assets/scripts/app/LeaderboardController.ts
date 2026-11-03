import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { loadLeaderboard } from '../services/pvpActions';
import type { ApiErrorCode, LeaderboardKind, LeaderboardResponse } from '../../lib/protocol';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel } from '../ui/kit';
import { createEmptyState, createErrorState, createLoadingState } from '../ui/states';
import { makeLabel, place } from '../ui/nodes';
import { createTitle } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

type Phase = 'loading' | 'ready' | 'error';

const TABS: Array<{ kind: LeaderboardKind; label: string }> = [
  { kind: 'rating', label: '段位' },
  { kind: 'codex', label: '图鉴' },
  { kind: 'gene', label: '最佳基因' },
  { kind: 'generation', label: '世代' },
];

const VALUE_SUFFIX: Record<LeaderboardKind, string> = {
  rating: '分',
  codex: '种',
  gene: '',
  generation: '代',
};

const INELIGIBLE_TEXT: Record<LeaderboardKind, string> = {
  rating: '完成一场真人 PvP 后上榜（机器人对局不计）',
  codex: '拥有至少 1 只宠物后上榜',
  gene: '拥有至少 1 只非蛋宠物后上榜',
  generation: '拥有至少 1 只非蛋宠物后上榜',
};

/** M2-06 排行榜：四个 tab、前 N + 自己、selfEligible=false 文案。 */
@ccclass('LeaderboardController')
export class LeaderboardController extends Component {
  private view: SceneView | null = null;
  private kind: LeaderboardKind = 'rating';
  private phase: Phase = 'loading';
  private cache: Partial<Record<LeaderboardKind, LeaderboardResponse>> = {};
  private error: { code?: ApiErrorCode; message: string } | null = null;

  start(): void {
    this.view = new SceneView(this, 'leaderboard-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init().then(() => this.load(this.kind));
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private async load(kind: LeaderboardKind): Promise<void> {
    const cached = this.cache[kind];
    if (cached) {
      this.phase = 'ready';
      this.error = null;
      this.view?.refresh();
      return;
    }
    this.phase = 'loading';
    this.error = null;
    this.view?.refresh();
    const result = await loadLeaderboard(kind);
    if (!result.ok || !result.data) {
      this.phase = 'error';
      this.error = { code: result.code, message: result.message };
      this.view?.refresh();
      return;
    }
    this.cache[kind] = result.data;
    this.phase = 'ready';
    this.view?.refresh();
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '排行榜');
    place(title.node, 0, 440);

    const back = createButton(root, frames, {
      text: '返回主页',
      width: 260,
      height: 72,
      variant: 'secondary',
      onClick: () => gotoScene('home'),
    });
    place(back, -800, 440);

    TABS.forEach((tab, index) => {
      const button = createButton(root, frames, {
        text: tab.label,
        width: 220,
        height: 64,
        variant: this.kind === tab.kind ? 'primary' : 'secondary',
        onClick: () => {
          if (this.kind === tab.kind) return;
          this.kind = tab.kind;
          void this.load(tab.kind);
        },
      });
      place(button, (index - 1.5) * 250, 360);
    });

    if (this.phase === 'loading') {
      const loading = createLoadingState(root, frames, { text: '正在加载排行榜…' });
      place(loading, 0, 0);
      return;
    }
    if (this.phase === 'error') {
      const error = createErrorState(root, frames, {
        code: this.error?.code,
        message: this.error?.message ?? '排行榜加载失败',
        retryText: '重试',
        onRetry: () => void this.load(this.kind),
        onBack: () => gotoScene('home'),
      });
      place(error, 0, 0);
      return;
    }

    const data = this.cache[this.kind];
    if (!data) {
      const empty = createEmptyState(root, frames, { text: '暂无排行榜数据' });
      place(empty, 0, 0);
      return;
    }

    const panel = createPanel(root, frames, 1500, 650, COLORS.panel);
    place(panel, 0, -20);

    if (data.entries.length === 0) {
      const empty = createEmptyState(panel, frames, { text: '本榜暂无符合资格的数据' });
      place(empty, 0, 0);
      return;
    }

    const header = makeLabel(panel, `排名          训练师                          数值`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      align: 'left',
      width: 1380,
    });
    place(header.node, 0, 272);

    const profile = state.profile;
    data.entries.forEach((entry, index) => {
      const y = 230 - index * 24;
      const isSelf = profile && entry.accountId === profile.accountId;
      const row = makeLabel(
        panel,
        `${String(entry.rank).padStart(2, ' ')}        ${entry.displayName}${isSelf ? '（你）' : ''}        ${entry.value}${VALUE_SUFFIX[data.kind]}`,
        {
          fontSize: 16,
          color: isSelf ? COLORS.accent : index < 3 ? COLORS.text : COLORS.textDim,
          align: 'left',
          width: 1380,
          height: 24,
        },
      );
      place(row.node, 0, y);
    });

    const self = data.self;
    if (self) {
      const selfText =
        self.rank <= data.entries.length
          ? `你的排名 #${self.rank} · ${self.value}${VALUE_SUFFIX[data.kind]}`
          : `你的排名 #${self.rank}（未进入前 ${data.entries.length}）· ${self.value}${VALUE_SUFFIX[data.kind]}`;
      const selfLabel = makeLabel(panel, selfText, {
        fontSize: FONT_SIZE.body,
        color: COLORS.accent,
      });
      place(selfLabel.node, 0, -276);
    } else {
      const reason = makeLabel(panel, `未上榜：${INELIGIBLE_TEXT[data.kind]}`, {
        fontSize: FONT_SIZE.body,
        color: COLORS.textDim,
        width: 1300,
        wrap: true,
      });
      place(reason.node, 0, -276);
    }

    const footer = makeLabel(panel, `赛季 ${data.seasonId} · 前 ${data.entries.length} 名 + 自己 · 机器人不计榜`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(footer.node, 0, -320);
  }
}
