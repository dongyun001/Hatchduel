import { _decorator, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { getConfigRepo } from '../services/config';
import { nowMs } from '../services/bootstrap';
import { cloneProfile } from '../dev/clone';
import { createMockRng } from '../dev/mockRng';
import { breed, checkBreeding, isInbred } from '../../lib/core';
import type { BreedCheck, BreedError, CoreStatKey, PetInstance, Profile, ResourceId } from '../../lib/core';
import { COLORS, DESIGN, FONT_SIZE, SPRITE_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makePanel, makeSprite, paint, place } from '../ui/nodes';
import { createTitle, elementName, elementTint, genderMark, speciesName, stageName } from '../ui/screens';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

const GENE_KEYS: CoreStatKey[] = ['hp', 'atk', 'def', 'spd'];
const GENE_NAMES: Record<CoreStatKey, string> = { hp: '生命', atk: '攻击', def: '防御', spd: '速度' };
const RESOURCE_NAMES: Record<ResourceId, string> = {
  coin: '金币',
  food: '食物',
  geneDust: '基因尘',
  premium: '钻石',
};
const SELECTED_TINT = '#2f5a70';

const REASON_TEXT: Record<BreedError, string> = {
  not_adult: '未到成年',
  cooldown: '还在冷却中',
  same_pet: '不能和自己繁殖',
  same_gender: '需要一公一母',
  no_capacity: '容量已满（先升级栖息地）',
  cost: '资源不足',
  locked: '宠物已锁定',
  infertile: '不可繁殖',
};

function isAdult(pet: PetInstance): boolean {
  return pet.stage === 'adult' || pet.stage === 'elder';
}

function cooldownText(pet: PetInstance, profile: Profile, now: number): string {
  const until = Math.max(pet.fertility.cooldownUntil, profile.breeding.cooldowns[pet.id] ?? 0);
  if (now < until) return '冷却中';
  if (now < pet.fertility.readyAt) return '未成熟';
  return '可繁殖';
}

function clampGene(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Breeding：双亲选择、基因区间预览、近亲警告、成本与校验。
 * 提交在当前阶段走本地 mock：checkBreeding 校验 + core `breed` 产蛋；
 * 等 C 的 /breeding/start 就绪后替换为 ApiClient（不重写公式）。
 */
@ccclass('BreedingController')
export class BreedingController extends Component {
  private view: SceneView | null = null;
  private parentA: string | null = null;
  private parentB: string | null = null;
  private initialised = false;
  private submitting = false;

  start(): void {
    this.view = new SceneView(this, 'breeding-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '繁殖');
    place(title.node, 0, 490);

    const profile = state.profile;
    if (!profile) {
      const empty = makeLabel(root, '没有存档：请从 Boot 启动', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      return;
    }

    const cfg = getConfigRepo();
    const now = nowMs();
    const adults = Object.values(profile.pets).filter(isAdult);
    this.ensureSelection(profile, adults);

    const a = this.parentA ? profile.pets[this.parentA] : undefined;
    const b = this.parentB ? profile.pets[this.parentB] : undefined;
    const check: BreedCheck | null = a && b ? checkBreeding(a, b, now, profile, cfg) : null;
    const inbred = a && b ? isInbred(a, b, cfg.breeding().inbreeding.generations) : false;

    // 成年宠物选择条
    const visible = adults.slice(0, 5);
    visible.forEach((pet, index) => {
      const x = (index - (visible.length - 1) / 2) * 250;
      const selected = pet.id === this.parentA || pet.id === this.parentB;
      const chip = makePanel(root, 220, 120);
      paint(chip, frames.white, selected ? SELECTED_TINT : COLORS.panel);
      place(chip, x, 360);
      chip.on(Node.EventType.TOUCH_END, () => this.pick(pet.id));

      const icon = makeSprite(
        chip,
        this.iconFrame(pet, frames),
        SPRITE_SIZE.icon32 * DESIGN.pixelScale,
        SPRITE_SIZE.icon32 * DESIGN.pixelScale,
        elementTint(pet.elementId),
      );
      place(icon.node, -60, 0);
      const label = makeLabel(chip, `${speciesName(pet.speciesId)}\n${genderMark(pet.gender)} ${stageName(pet.stage)}`, {
        fontSize: 16,
        color: COLORS.text,
        width: 130,
        height: 52,
        wrap: true,
      });
      place(label.node, 40, 0);
    });

    this.renderParentCard(root, frames, profile, a, -520, 40, '亲代 A');
    this.renderParentCard(root, frames, profile, b, 520, 40, '亲代 B');
    this.renderPreview(root, frames, a, b, check, inbred);

    const back = makeButton(root, '返回主页', 380, 84, frames.white, () => gotoScene('home'));
    place(back, -420, -380);
    const submit = makeButton(
      root,
      '提交繁殖（离线）',
      380,
      84,
      frames.white,
      () => void this.submit(a, b),
      check?.ok ? SELECTED_TINT : COLORS.panelAlt,
    );
    place(submit, 0, -380);
    const toList = makeButton(root, '宠物列表', 380, 84, frames.white, () => gotoScene('petList'));
    place(toList, 420, -380);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -310);
    }
  }

  private ensureSelection(profile: Profile, adults: PetInstance[]): void {
    const valid = (id: string | null): boolean => Boolean(id && profile.pets[id]);
    if (!valid(this.parentA)) this.parentA = null;
    if (!valid(this.parentB)) this.parentB = null;
    if (this.initialised) return;
    this.initialised = true;
    const male = adults.find((pet) => pet.gender === 'male');
    const female = adults.find((pet) => pet.gender === 'female');
    this.parentA = male?.id ?? adults[0]?.id ?? null;
    this.parentB = female?.id ?? adults[1]?.id ?? null;
    if (this.parentA === this.parentB) this.parentB = null;
  }

  private pick(petId: string): void {
    if (this.parentA === petId) {
      this.parentA = null;
    } else if (this.parentB === petId) {
      this.parentB = null;
    } else if (!this.parentA) {
      this.parentA = petId;
    } else if (!this.parentB) {
      this.parentB = petId;
    } else {
      this.parentA = this.parentB;
      this.parentB = petId;
    }
    this.view?.refresh();
  }

  private iconFrame(pet: PetInstance, frames: PlaceholderFrames) {
    if (pet.speciesId === 'turtle') return frames.petTurtle;
    if (pet.speciesId === 'fish') return frames.petFish;
    if (pet.speciesId === 'frog') return frames.petFrog;
    return frames.silhouette;
  }

  private renderParentCard(
    root: Node,
    frames: PlaceholderFrames,
    profile: Profile,
    pet: PetInstance | undefined,
    x: number,
    y: number,
    title: string,
  ): void {
    const card = makePanel(root, 360, 420);
    paint(card, frames.white, COLORS.panel);
    place(card, x, y);

    const titleLabel = makeLabel(card, title, { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(titleLabel.node, 0, 180);

    if (!pet) {
      const empty = makeLabel(card, '点击上方宠物选择', { fontSize: FONT_SIZE.small, color: COLORS.textDim });
      place(empty.node, 0, 0);
      return;
    }

    const icon = makeSprite(
      card,
      this.iconFrame(pet, frames),
      SPRITE_SIZE.pet * DESIGN.pixelScale,
      SPRITE_SIZE.pet * DESIGN.pixelScale,
      elementTint(pet.elementId),
    );
    place(icon.node, 0, 50);

    const name = makeLabel(card, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}`, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
    });
    place(name.node, 0, -85);

    const meta = makeLabel(card, `${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(meta.node, 0, -120);

    const genes = `生命 ${pet.genome.stats.hp}  攻击 ${pet.genome.stats.atk}\n防御 ${pet.genome.stats.def}  速度 ${pet.genome.stats.spd}`;
    const geneLabel = makeLabel(card, genes, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
      width: 320,
      height: 50,
      wrap: true,
    });
    place(geneLabel.node, 0, -155);

    const status = cooldownText(pet, profile, nowMs());
    const statusLabel = makeLabel(card, status, {
      fontSize: FONT_SIZE.small,
      color: status === '可繁殖' ? COLORS.good : COLORS.danger,
    });
    place(statusLabel.node, 0, -195);
  }

  private renderPreview(
    root: Node,
    frames: PlaceholderFrames,
    a: PetInstance | undefined,
    b: PetInstance | undefined,
    check: BreedCheck | null,
    inbred: boolean,
  ): void {
    const cfg = getConfigRepo();
    const panel = makePanel(root, 560, 420);
    paint(panel, frames.white, COLORS.panel);
    place(panel, 0, 40);

    const title = makeLabel(panel, '子代预览', { fontSize: FONT_SIZE.heading, color: COLORS.text });
    place(title.node, 0, 180);

    if (!a || !b) {
      const hint = makeLabel(panel, '选择两只成年宠物后显示基因区间', {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
        width: 500,
        wrap: true,
      });
      place(hint.node, 0, 0);
      return;
    }

    const breeding = cfg.breeding();
    const speciesText = `物种：${speciesName(a.speciesId)} / ${speciesName(b.speciesId)}（各 50%）`;
    const elementText = `属性：${elementName(a.elementId)} / ${elementName(b.elementId)}（各 50%，1% 突变）`;
    const speciesLabel = makeLabel(panel, speciesText, { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 500, wrap: true });
    place(speciesLabel.node, 0, 135);
    const elementLabel = makeLabel(panel, elementText, { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 500, wrap: true });
    place(elementLabel.node, 0, 105);

    const penalty = inbred ? breeding.inbreeding.genePenalty : 0;
    GENE_KEYS.forEach((key, index) => {
      const mean = (a.genome.stats[key] + b.genome.stats[key]) / 2 - penalty;
      const low = clampGene(mean - breeding.mutation.geneSigma);
      const high = clampGene(mean + breeding.mutation.geneSigma);
      const text = `${GENE_NAMES[key]}  ${low} ~ ${high}（均值 ${clampGene(mean)}）`;
      const label = makeLabel(panel, text, { fontSize: FONT_SIZE.body, color: COLORS.text, width: 500, wrap: true });
      place(label.node, 0, 68 - index * 34);
    });

    if (inbred) {
      const warning = makeLabel(panel, '⚠ 近亲：3 代内共同祖先（基因 -5，突变 +2%）', {
        fontSize: FONT_SIZE.small,
        color: COLORS.danger,
        width: 500,
        wrap: true,
      });
      place(warning.node, 0, -82);
    }

    const status = check?.ok
      ? '校验通过：可以繁殖'
      : `不可繁殖：${REASON_TEXT[(check?.reason ?? 'infertile') as BreedError] ?? '未知原因'}`;
    const statusLabel = makeLabel(panel, status, {
      fontSize: FONT_SIZE.small,
      color: check?.ok ? COLORS.good : COLORS.danger,
      width: 500,
      wrap: true,
    });
    place(statusLabel.node, 0, -118);

    const costText = `成本：${breeding.cost
      .map((item) => `${RESOURCE_NAMES[item.resource]} ${item.amount}`)
      .join(' · ')}`;
    const costLabel = makeLabel(panel, costText, { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 500, wrap: true });
    place(costLabel.node, 0, -158);
  }

  private async submit(a: PetInstance | undefined, b: PetInstance | undefined): Promise<void> {
    if (this.submitting) return;
    const profile = appStore.getState().profile;
    if (!profile || !a || !b) {
      this.view?.showToast('请选择两只成年宠物');
      return;
    }
    const cfg = getConfigRepo();
    const now = nowMs();
    const check = checkBreeding(a, b, now, profile, cfg);
    if (!check.ok) {
      this.view?.showToast(`不能繁殖：${REASON_TEXT[(check.reason ?? 'infertile') as BreedError] ?? '未知原因'}`);
      return;
    }

    this.submitting = true;
    try {
      const result = breed(a, b, now, cfg, createMockRng());
      const next = cloneProfile(profile);
      for (const cost of cfg.breeding().cost) {
        next.currencies[cost.resource] = (next.currencies[cost.resource] ?? 0) - cost.amount;
      }
      next.pets[result.child.id] = result.child;
      next.breeding.eggs.push(result.child.id);
      next.breeding.cooldowns[a.id] = result.parentCooldowns[0];
      next.breeding.cooldowns[b.id] = result.parentCooldowns[1];
      const parentA = next.pets[a.id];
      if (parentA) parentA.fertility.cooldownUntil = result.parentCooldowns[0];
      const parentB = next.pets[b.id];
      if (parentB) parentB.fertility.cooldownUntil = result.parentCooldowns[1];
      next.stats.breeds += 1;
      appStore.setProfile(next);
      appStore.setSelectedPet(result.child.id);
      this.view?.showToast(
        `产下 ${speciesName(result.child.speciesId)} 蛋${result.inbred ? '（近亲）' : ''}（离线演示）`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.view?.showToast(`繁殖失败：${message}`);
    } finally {
      this.submitting = false;
    }
  }
}
