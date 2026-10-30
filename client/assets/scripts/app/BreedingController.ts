import { _decorator, Component, Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { getConfigRepo } from '../services/config';
import { nowMs } from '../services/bootstrap';
import {
  claimEggAction,
  hatchRemainingMs,
  startBreedingAction,
  tickEggHatch,
} from '../services/breedingActions';
import { checkBreeding, isInbred } from '../../lib/core';
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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Breeding：双亲选择、基因区间、近亲警告、成本、产蛋与孵蛋领取。
 * 预览用 checkBreeding/isInbred；提交与领取走 breedingActions（服务端 /breeding/* 或离线 core）。
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
    this.schedule(this.onTick, 1);
  }

  onDestroy(): void {
    this.unschedule(this.onTick);
    this.view?.dispose();
    this.view = null;
  }

  private onTick = (): void => {
    if (!this.view) return;
    const profile = appStore.getState().profile;
    const hasEgg = Boolean(profile && profile.breeding.eggs.length > 0);
    tickEggHatch();
    if (hasEgg) this.view.refresh();
  };

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
      place(chip, x, 380);
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

    this.renderParentCard(root, frames, profile, a, -520, 70, '亲代 A');
    this.renderParentCard(root, frames, profile, b, 520, 70, '亲代 B');
    this.renderPreview(root, frames, a, b, check, inbred);
    this.renderEggs(root, frames, profile);

    const back = makeButton(root, '返回主页', 380, 84, frames.white, () => gotoScene('home'));
    place(back, -420, -400);
    const submit = makeButton(
      root,
      '提交繁殖',
      380,
      84,
      frames.white,
      () => void this.submit(a, b),
      check?.ok ? SELECTED_TINT : COLORS.panelAlt,
    );
    place(submit, 0, -400);
    const toList = makeButton(root, '宠物列表', 380, 84, frames.white, () => gotoScene('petList'));
    place(toList, 420, -400);

    const mode =
      state.remote.mode === 'mock'
        ? '离线演示：startBreeding / claimBreeding 走 core'
        : `服务端模式 · revision ${profile.revision}`;
    const footer = makeLabel(root, mode, { fontSize: FONT_SIZE.small, color: COLORS.textDim });
    place(footer.node, 0, -495);

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -340);
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
    const card = makePanel(root, 380, 420);
    paint(card, frames.white, COLORS.panel);
    place(card, x, y);

    const titleLabel = makeLabel(card, title, { fontSize: FONT_SIZE.body, color: COLORS.accent });
    place(titleLabel.node, 0, 190);

    if (!pet) {
      const empty = makeLabel(card, '点击上方宠物选择', { fontSize: FONT_SIZE.small, color: COLORS.textDim });
      place(empty.node, 0, 0);
      return;
    }

    const icon = makeSprite(
      card,
      this.iconFrame(pet, frames),
      SPRITE_SIZE.petSmall * DESIGN.pixelScale,
      SPRITE_SIZE.petSmall * DESIGN.pixelScale,
      elementTint(pet.elementId),
    );
    place(icon.node, 0, 55);

    const name = makeLabel(card, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}`, {
      fontSize: FONT_SIZE.heading,
      color: COLORS.text,
    });
    place(name.node, 0, -70);

    const meta = makeLabel(card, `${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(meta.node, 0, -112);

    const genes = `生命 ${pet.genome.stats.hp}  攻击 ${pet.genome.stats.atk}  防御 ${pet.genome.stats.def}  速度 ${pet.genome.stats.spd}`;
    const geneLabel = makeLabel(card, genes, {
      fontSize: 17,
      color: COLORS.textDim,
      width: 350,
      height: 24,
      wrap: true,
    });
    place(geneLabel.node, 0, -145);

    const status = cooldownText(pet, profile, nowMs());
    const statusLabel = makeLabel(card, status, {
      fontSize: FONT_SIZE.small,
      color: status === '可繁殖' ? COLORS.good : COLORS.danger,
    });
    place(statusLabel.node, 0, -188);
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
    place(panel, 0, 70);

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
    place(speciesLabel.node, 0, 130);
    const elementLabel = makeLabel(panel, elementText, { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 500, wrap: true });
    place(elementLabel.node, 0, 100);

    const penalty = inbred ? breeding.inbreeding.genePenalty : 0;
    GENE_KEYS.forEach((key, index) => {
      const mean = (a.genome.stats[key] + b.genome.stats[key]) / 2 - penalty;
      const low = clampGene(mean - breeding.mutation.geneSigma);
      const high = clampGene(mean + breeding.mutation.geneSigma);
      const text = `${GENE_NAMES[key]}  ${low} ~ ${high}（均值 ${clampGene(mean)}）`;
      const label = makeLabel(panel, text, { fontSize: FONT_SIZE.body, color: COLORS.text, width: 500, wrap: true });
      place(label.node, 0, 62 - index * 32);
    });

    if (inbred) {
      const warning = makeLabel(panel, '⚠ 近亲：3 代内共同祖先（基因 -5，突变 +2%）', {
        fontSize: FONT_SIZE.small,
        color: COLORS.danger,
        width: 500,
        wrap: true,
      });
      place(warning.node, 0, -85);
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
    place(statusLabel.node, 0, -125);

    const costText = `成本：${breeding.cost
      .map((item) => `${RESOURCE_NAMES[item.resource]} ${item.amount}`)
      .join(' · ')}`;
    const costLabel = makeLabel(panel, costText, { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 500, wrap: true });
    place(costLabel.node, 0, -168);
  }

  private renderEggs(root: Node, frames: PlaceholderFrames, profile: Profile): void {
    const panel = makePanel(root, 1600, 170);
    paint(panel, frames.white, COLORS.panel);
    place(panel, 0, -230);

    const eggs = profile.breeding.eggs
      .map((id) => profile.pets[id])
      .filter((pet): pet is PetInstance => Boolean(pet));
    const title = makeLabel(panel, `蛋（${eggs.length}）· 孵化后点击蛋领取`, {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(title.node, 0, 60);

    if (eggs.length === 0) {
      const empty = makeLabel(panel, '还没有蛋；选择双亲后提交繁殖', {
        fontSize: FONT_SIZE.small,
        color: COLORS.textDim,
      });
      place(empty.node, 0, -20);
      return;
    }

    eggs.slice(0, 4).forEach((egg, index) => {
      const x = (index - (Math.min(eggs.length, 4) - 1) / 2) * 390;
      const card = makePanel(panel, 360, 120);
      paint(card, frames.white, '#2b4252');
      place(card, x, -25);
      card.on(Node.EventType.TOUCH_END, () => void this.onClaimEgg(egg.id));

      const icon = makeSprite(
        card,
        frames.egg,
        SPRITE_SIZE.icon48 * DESIGN.pixelScale,
        SPRITE_SIZE.icon48 * DESIGN.pixelScale,
        elementTint(egg.elementId),
      );
      place(icon.node, -110, 0);

      const remaining = hatchRemainingMs(egg);
      const ready = egg.stage !== 'egg' || remaining <= 0;
      const stateText = ready ? '可领取' : `孵化中 ${formatCountdown(remaining)}`;
      const name = makeLabel(card, speciesName(egg.speciesId), {
        fontSize: FONT_SIZE.body,
        color: COLORS.text,
        align: 'left',
        width: 140,
      });
      place(name.node, 60, 22);
      const stateLabel = makeLabel(card, stateText, {
        fontSize: FONT_SIZE.small,
        color: ready ? COLORS.good : COLORS.accent,
        align: 'left',
        width: 140,
      });
      place(stateLabel.node, 60, -14);
      const sub = makeLabel(card, `${stageName(egg.stage)} · 世代 ${egg.generation}`, {
        fontSize: 13,
        color: COLORS.textDim,
        align: 'left',
        width: 140,
      });
      place(sub.node, 60, -44);
    });
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
      const result = await startBreedingAction(a.id, b.id);
      this.view?.showToast(`${result.message}${result.inbred ? '（近亲）' : ''}`);
    } finally {
      this.submitting = false;
    }
  }

  private async onClaimEgg(eggId: string): Promise<void> {
    const profile = appStore.getState().profile;
    const egg = profile?.pets[eggId];
    if (!egg) return;
    const remaining = hatchRemainingMs(egg);
    if (egg.stage === 'egg' && remaining > 0) {
      this.view?.showToast(`还没孵化：还剩 ${formatCountdown(remaining)}`);
      return;
    }
    const result = await claimEggAction(eggId);
    const suffix = result.pet ? `：${speciesName(result.pet.speciesId)}` : '';
    this.view?.showToast(`${result.message}${suffix}`);
  }
}
