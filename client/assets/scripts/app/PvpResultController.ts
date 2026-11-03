import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { retryLastFight } from '../services/pvpActions';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, createPanel, createTag } from '../ui/kit';
import { createEmptyState, createErrorState } from '../ui/states';
import { makeLabel, place } from '../ui/nodes';
import { createTitle } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

function deltaText(before: number, after: number): string {
  const delta = after - before;
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * M2-04 战斗结果（攻方视角）：胜负/平、回合数、双方 rating 变化、replayId。
 * 失败分支（429/409/410/校验）从 store 读错误码，用统一的 Error 态展示。
 */
@ccclass('PvpResultController')
export class PvpResultController extends Component {
  private view: SceneView | null = null;

  start(): void {
    this.view = new SceneView(this, 'pvpresult-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '战斗结果');
    place(title.node, 0, 440);

    if (state.pvp.error) {
      const code = state.pvp.error.code;
      // 只有网络/5xx 才用同一 Idempotency-Key 重试；409 已用 latestProfile 重建，
      // 应回匹配页用新 revision 重新发起（同 key/同 base 会再次 409）。
      const retryable = !code || code === 'INTERNAL';
      const error = createErrorState(root, frames, {
        code,
        message: state.pvp.error.message,
        retryText: retryable ? '重试同一场' : '重新匹配',
        onRetry: retryable
          ? () => {
              void retryLastFight().then((result) => {
                if (!result.ok && result.message) appStore.setPvpError({ code: result.code, message: result.message });
              });
            }
          : () => {
              appStore.setPvpError(null);
              gotoScene('pvpOpponent');
            },
        backText: '返回主页',
        onBack: () => gotoScene('home'),
      });
      place(error, 0, 0);
      return;
    }

    const fight = state.pvp.lastFight;
    if (!fight) {
      const empty = createEmptyState(root, frames, {
        text: '还没有战报：先完成一场 PvP',
        actionText: '去匹配',
        onAction: () => gotoScene('pvpOpponent'),
      });
      place(empty, 0, 0);
      return;
    }

    const resultText = fight.result === 0 ? '胜利' : fight.result === 1 ? '失败' : '平局';
    const resultColor = fight.result === 0 ? COLORS.good : fight.result === 1 ? COLORS.danger : COLORS.accent;

    const banner = createPanel(root, frames, 1400, 200, COLORS.panel);
    place(banner, 0, 220);
    const result = makeLabel(banner, resultText, { fontSize: 72, color: resultColor });
    place(result.node, 0, 40);
    const meta = makeLabel(
      banner,
      `攻方视角 · ${fight.turns} 回合 · 赛季 ${fight.seasonId}${fight.isBot ? ' · 机器人（不计榜/不改段位）' : ''}`,
      { fontSize: FONT_SIZE.body, color: COLORS.textDim },
    );
    place(meta.node, 0, -50);
    if (fight.isBot) {
      const tag = createTag(banner, frames, 'BOT', COLORS.accent);
      place(tag, 600, 70);
    }

    const ratingPanel = createPanel(root, frames, 1400, 260, COLORS.panelAlt);
    place(ratingPanel, 0, -60);

    const selfTitle = makeLabel(ratingPanel, '你', { fontSize: FONT_SIZE.heading, color: COLORS.text, align: 'left', width: 500 });
    place(selfTitle.node, -380, 70);
    const selfRating = makeLabel(
      ratingPanel,
      `${fight.ratingBefore} → ${fight.ratingAfter}（${deltaText(fight.ratingBefore, fight.ratingAfter)}）`,
      { fontSize: 36, color: fight.ratingAfter >= fight.ratingBefore ? COLORS.good : COLORS.danger, align: 'left', width: 900 },
    );
    place(selfRating.node, 40, 70);

    const oppTitle = makeLabel(ratingPanel, fight.opponent.displayName, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
      align: 'left',
      width: 700,
    });
    place(oppTitle.node, -380, -30);
    const oppRating = makeLabel(
      ratingPanel,
      `${fight.opponent.ratingBefore} → ${fight.opponent.ratingAfter}（${deltaText(fight.opponent.ratingBefore, fight.opponent.ratingAfter)}）`,
      { fontSize: FONT_SIZE.body, color: COLORS.textDim, align: 'left', width: 900 },
    );
    place(oppRating.node, 40, -30);

    const replay = makeLabel(ratingPanel, `战报 ${fight.replayId} · 剩余 ${fight.challengesRemaining} 次`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(replay.node, 0, -95);

    const replayButton = createButton(root, frames, {
      text: '查看战报',
      width: 360,
      height: 88,
      variant: 'primary',
      onClick: () => gotoScene('pvpReplay'),
    });
    place(replayButton, -380, -340);

    const again = createButton(root, frames, {
      text: '再战',
      width: 360,
      height: 88,
      variant: 'secondary',
      onClick: () => {
        appStore.clearPvpResult();
        gotoScene('pvpOpponent');
      },
    });
    place(again, 0, -340);

    const home = createButton(root, frames, {
      text: '返回主页',
      width: 360,
      height: 88,
      variant: 'secondary',
      onClick: () => gotoScene('home'),
    });
    place(home, 380, -340);

    const hint = makeLabel(root, '回放只播放服务端存储的 events，不在客户端重新模拟。', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(hint.node, 0, -420);
  }
}
