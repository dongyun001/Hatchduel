import { _decorator, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { getConfigRepo } from '../services/config';
import { eligibleParty, saveLineup, startBattle } from '../services/battleActions';
import type { PetInstance, StageConfig, StageProgress } from '../../lib/core';
import { COLORS, DESIGN, FONT_SIZE, SPRITE_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makePanel, makeSprite, paint, place } from '../ui/nodes';
import { createTitle, elementName, elementTint, genderMark, speciesName, stageName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

const SELECTED_TINT = '#2f5a70';
const LOCKED_TINT = '#141e26';

function isUnlocked(stages: readonly StageConfig[], index: number, cleared: Record<string, StageProgress>): boolean {
  if (index <= 0) return true;
  const previous = stages[index - 1];
  return previous ? cleared[previous.id]?.cleared === true : false;
}

function stageEnemies(stage: StageConfig): string {
  return stage.enemies.map((enemy) => `${speciesName(enemy.speciesId)}·${elementName(enemy.elementId)} Lv.${enemy.level}`).join('、');
}

/**
 * StageSelect：关卡解锁、敌方预览与克制、编队选择、开战。
 * 开战前在服务端模式会先保存编队并 POST /battle/pve/start；离线模式用 core 构建 setup。
 */
@ccclass('StageSelectController')
export class StageSelectController extends Component {
  private view: SceneView | null = null;
  private selectedStageId: string | null = null;
  private selectedLineup: string[] = [];
  private initialised = false;

  start(): void {
    this.view = new SceneView(this, 'stageselect-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '关卡');
    place(title.node, 0, 490);

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      return;
    }

    const cfg = getConfigRepo();
    const stages = [...cfg.allStages()].sort((a, b) => a.order - b.order);
    const eligible = eligibleParty(profile);
    this.ensureSelection(stages, eligible, profile.stageProgress);

    // —— 编队条 ——
    const lineupLabel = makeLabel(root, `出战编队 ${this.selectedLineup.length}/3`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(lineupLabel.node, -780, 368);

    eligible.slice(0, 5).forEach((pet, index) => {
      this.renderLineupChip(root, frames, pet, index);
    });
    const save = makeButton(root, '保存编队', 180, 64, frames.white, () => void this.onSaveLineup());
    place(save, 780, 360);

    // —— 关卡列表 ——
    const listPanel = makePanel(root, 900, 620);
    paint(listPanel, frames.white, COLORS.panel);
    place(listPanel, -480, -60);
    const listTitle = makeLabel(listPanel, '关卡列表', { fontSize: FONT_SIZE.heading, color: COLORS.text });
    place(listTitle.node, 0, 260);

    stages.forEach((stage, index) => {
      const unlocked = isUnlocked(stages, index, profile.stageProgress);
      const cleared = profile.stageProgress[stage.id]?.cleared === true;
      const selected = this.selectedStageId === stage.id;
      const row = makePanel(listPanel, 820, 96);
      paint(row, frames.white, selected ? SELECTED_TINT : unlocked ? COLORS.panelAlt : LOCKED_TINT);
      place(row, 0, 180 - index * 105);
      if (unlocked) row.on(Node.EventType.TOUCH_END, () => this.selectStage(stage.id));

      const order = makeLabel(row, `${stage.order}`, { fontSize: 28, color: unlocked ? COLORS.accent : '#4a5a66' });
      place(order.node, -360, 0);
      const name = makeLabel(row, `${stage.name}${cleared ? ' · 已通关' : ''}`, {
        fontSize: FONT_SIZE.body,
        color: unlocked ? COLORS.text : '#5a6b78',
        align: 'left',
        width: 560,
      });
      place(name.node, 40, 16);
      const enemies = makeLabel(row, unlocked ? stageEnemies(stage) : '未解锁（先通关前一关）', {
        fontSize: FONT_SIZE.small,
        color: unlocked ? COLORS.textDim : '#4a5a66',
        align: 'left',
        width: 640,
      });
      place(enemies.node, 80, -20);
    });

    // —— 右侧详情 ——
    const stage = stages.find((item) => item.id === this.selectedStageId) ?? stages[0];
    this.renderDetail(root, frames, stage, eligible, profile.stageProgress);

    const back = makeButton(root, '返回主页', 380, 84, frames.white, () => gotoScene('home'));
    place(back, -420, -450);
    const fight = makeButton(
      root,
      '开始战斗',
      380,
      84,
      frames.white,
      () => void this.onStartFight(stage),
      SELECTED_TINT,
    );
    place(fight, 0, -450);
    const toList = makeButton(root, '宠物列表', 380, 84, frames.white, () => gotoScene('petList'));
    place(toList, 420, -450);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -390);
    }
  }

  private ensureSelection(
    stages: readonly StageConfig[],
    eligible: PetInstance[],
    cleared: Record<string, StageProgress>,
  ): void {
    if (this.selectedStageId && !stages.some((stage) => stage.id === this.selectedStageId)) {
      this.selectedStageId = null;
    }
    if (!this.selectedStageId) {
      const firstUnlocked = stages.find((stage, index) => isUnlocked(stages, index, cleared));
      this.selectedStageId = firstUnlocked?.id ?? stages[0]?.id ?? null;
    }
    const allowed = new Set(eligible.map((pet) => pet.id));
    this.selectedLineup = this.selectedLineup.filter((id) => allowed.has(id)).slice(0, 3);
    if (!this.initialised) {
      this.initialised = true;
      const profile = appStore.getState().profile;
      const preferred = profile?.lineup.filter((id) => allowed.has(id)).slice(0, 3) ?? [];
      this.selectedLineup = preferred.length > 0 ? preferred : eligible.slice(0, 3).map((pet) => pet.id);
    }
  }

  private selectStage(stageId: string): void {
    this.selectedStageId = stageId;
    this.view?.refresh();
  }

  private renderLineupChip(root: Node, frames: PlaceholderFrames, pet: PetInstance, index: number): void {
    const selected = this.selectedLineup.includes(pet.id);
    const chip = makePanel(root, 220, 90);
    paint(chip, frames.white, selected ? SELECTED_TINT : COLORS.panel);
    place(chip, -500 + index * 240, 360);
    chip.on(Node.EventType.TOUCH_END, () => this.toggleLineup(pet.id));

    const icon = makeSprite(
      chip,
      this.iconFrame(pet, frames),
      SPRITE_SIZE.icon32 * DESIGN.pixelScale,
      SPRITE_SIZE.icon32 * DESIGN.pixelScale,
      elementTint(pet.elementId),
    );
    place(icon.node, -58, 0);
    const label = makeLabel(chip, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}\n${stageName(pet.stage)} Lv.${pet.level}`, {
      fontSize: 15,
      color: COLORS.text,
      width: 130,
      height: 52,
      wrap: true,
    });
    place(label.node, 42, 0);
  }

  private toggleLineup(petId: string): void {
    if (this.selectedLineup.includes(petId)) {
      this.selectedLineup = this.selectedLineup.filter((id) => id !== petId);
    } else if (this.selectedLineup.length >= 3) {
      appStore.setToast('编队最多 3 只，先取消一只');
      return;
    } else {
      this.selectedLineup = [...this.selectedLineup, petId];
    }
    this.view?.refresh();
  }

  private async onSaveLineup(): Promise<void> {
    if (this.selectedLineup.length === 0) {
      appStore.setToast('至少选择 1 只宠物');
      return;
    }
    const result = await saveLineup(this.selectedLineup);
    appStore.setToast(result.message);
  }

  private async onStartFight(stage: StageConfig): Promise<void> {
    if (this.selectedLineup.length === 0) {
      appStore.setToast('至少选择 1 只出战宠物');
      return;
    }
    const result = await startBattle(stage.id, this.selectedLineup);
    if (!result.started) {
      appStore.setToast(result.message);
      return;
    }
    gotoScene('battle');
  }

  private renderDetail(
    root: Node,
    frames: PlaceholderFrames,
    stage: StageConfig | undefined,
    party: PetInstance[],
    cleared: Record<string, StageProgress>,
  ): void {
    const panel = makePanel(root, 760, 620);
    paint(panel, frames.white, COLORS.panel);
    place(panel, 520, -60);

    if (!stage) {
      const empty = makeLabel(panel, '没有关卡配置', { fontSize: FONT_SIZE.body, color: COLORS.textDim });
      place(empty.node, 0, 0);
      return;
    }

    const cfg = getConfigRepo();
    const stageTitle = makeLabel(panel, `${stage.order}. ${stage.name}`, { fontSize: FONT_SIZE.heading, color: COLORS.text });
    place(stageTitle.node, 0, 260);
    const progress = cleared[stage.id];
    const status = progress?.cleared
      ? `已通关${progress.bestTurns ? ` · 最佳 ${progress.bestTurns} 回合` : ''}`
      : '未通关';
    const statusLabel = makeLabel(panel, status, { fontSize: FONT_SIZE.small, color: COLORS.textDim });
    place(statusLabel.node, 0, 226);

    const enemyTitle = makeLabel(panel, '敌方', { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(enemyTitle.node, 0, 190);

    stage.enemies.forEach((enemy, index) => {
      const y = 150 - index * 74;
      const line = makeLabel(
        panel,
        `${speciesName(enemy.speciesId)}·${elementName(enemy.elementId)} Lv.${enemy.level}`,
        { fontSize: FONT_SIZE.body, color: COLORS.text, align: 'left', width: 680, height: 30, wrap: true },
      );
      place(line.node, 20, y + 14);

      const counters: string[] = [];
      const counteredBy: string[] = [];
      for (const pet of party) {
        if (cfg.counterMultiplier(pet.speciesId, enemy.speciesId) === 1.25) {
          counters.push(speciesName(pet.speciesId));
        }
        if (cfg.counterMultiplier(enemy.speciesId, pet.speciesId) === 1.25) {
          counteredBy.push(speciesName(pet.speciesId));
        }
      }
      const detail = [
        counters.length > 0 ? `我方克制：${counters.join('、')}` : '',
        counteredBy.length > 0 ? `被敌方克制：${counteredBy.join('、')}` : '',
      ]
        .filter(Boolean)
        .join('   ');
      const counterLabel = makeLabel(panel, detail || '无克制关系', {
        fontSize: FONT_SIZE.small,
        color: detail ? COLORS.accent : COLORS.textDim,
        align: 'left',
        width: 680,
        height: 28,
        wrap: true,
      });
      place(counterLabel.node, 20, y - 18);
    });

    const rewardTitle = makeLabel(panel, '首通奖励', { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(rewardTitle.node, 0, -110);
    const rewards = stage.rewards.firstClear;
    const parts: string[] = [];
    if (rewards) {
      for (const [resource, amount] of Object.entries(rewards.resources ?? {})) {
        if (amount !== undefined) parts.push(`${resource} +${amount}`);
      }
      if (rewards.petExp) parts.push(`经验 +${rewards.petExp}`);
      if (rewards.pets && rewards.pets.length > 0) parts.push(`新宠物 ×${rewards.pets.length}`);
    }
    const rewardLabel = makeLabel(panel, parts.join(' · ') || '无', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      width: 680,
      wrap: true,
    });
    place(rewardLabel.node, 0, -145);

    const hint = makeLabel(panel, '战斗由 BattleEngine 本地演出；服务端会重放完整指令校验结果', {
      fontSize: 14,
      color: COLORS.textDim,
      width: 680,
      wrap: true,
    });
    place(hint.node, 0, -235);
  }

  private iconFrame(pet: PetInstance, frames: PlaceholderFrames) {
    if (pet.speciesId === 'turtle') return frames.petTurtle;
    if (pet.speciesId === 'fish') return frames.petFish;
    if (pet.speciesId === 'frog') return frames.petFrog;
    return frames.silhouette;
  }
}
