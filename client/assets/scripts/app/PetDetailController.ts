import { _decorator, Component, type Node } from 'cc';
import { appStore } from './store';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { getConfigRepo } from '../services/config';
import { movePetAction } from '../services/habitatActions';
import { previewRelease, releasePetAction, renamePetAction, setPetLockAction } from '../services/petActions';
import type { ReleasePreview } from '../services/petActions';
import { deriveStats } from '../../lib/core';
import type { PetInstance, Profile } from '../../lib/core';
import { COLORS, FONT_SIZE } from '../ui/theme';
import { createButton, renderToast, showConfirm } from '../ui/kit';
import { createEmptyState, createErrorState } from '../ui/states';
import { makeLabel, makeSprite, place } from '../ui/nodes';
import { createTitle, elementName, elementTint, genderMark, petDisplayName, stageName } from '../ui/screens';
import { showRenameDialog } from '../ui/renameDialog';
import { SceneView } from '../ui/sceneView';
import type { PlaceholderFrames } from '../ui/placeholders';

const { ccclass } = _decorator;

const SECTION_TITLES = ['八项属性', '基因', '特质（显性/隐性）', '血统', '相性 / 克制', '技能'];

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number): string {
  const text = percent(value);
  return value >= 0 ? `+${text}` : text;
}

/**
 * PetDetail：八项派生属性、基因、显性/隐性特质、血统、相性/克制、技能；
 * 支持改名（UI-06）、移出/放入栖息地、锁定、放生（二次确认）。
 */
@ccclass('PetDetailController')
export class PetDetailController extends Component {
  private view: SceneView | null = null;
  /** 放生二次确认；null 表示不显示。 */
  private confirm: { petId: string; body: string } | null = null;
  private renameOpen = false;

  start(): void {
    this.view = new SceneView(this, 'petdetail-root', (root, frames, state) => this.renderScene(root, frames, state));
    void this.view.init();
  }

  onDestroy(): void {
    this.view?.dispose();
    this.view = null;
  }

  private renderScene(root: Node, frames: PlaceholderFrames, state: Readonly<AppState>): void {
    const title = createTitle(root, '宠物详情');
    place(title.node, 0, 490);

    const profile = state.profile;
    const petId = state.ui.selectedPetId;
    const pet = profile && petId ? profile.pets[petId] : undefined;

    if (!profile) {
      const error = createErrorState(root, frames, {
        message: '没有存档，无法显示宠物详情。',
        retryText: '重新启动',
        onRetry: () => gotoScene('boot'),
      });
      place(error, 0, 0);
      renderToast(root, state.ui.toast, frames);
      return;
    }
    if (!pet) {
      const empty = createEmptyState(root, frames, {
        text: '没有选中的宠物',
        actionText: '返回列表',
        onAction: () => gotoScene('petList'),
      });
      place(empty, 0, 0);
      renderToast(root, state.ui.toast, frames);
      return;
    }

    const cfg = getConfigRepo();
    const stats = deriveStats(pet, cfg);
    const species = cfg.species(pet.speciesId);

    const portrait = makeSprite(root, frames.portrait, 256 * 3, 256 * 3, elementTint(pet.elementId));
    place(portrait.node, -520, 120);

    const name = makeLabel(root, `${petDisplayName(pet)} ${genderMark(pet.gender)}`, {
      fontSize: 36,
      color: COLORS.text,
    });
    place(name.node, -520, -300);

    const meta = makeLabel(
      root,
      `${species.name} · ${elementName(pet.elementId)}属性 · ${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}${pet.locked ? ' · 已锁定' : ''}`,
      { fontSize: FONT_SIZE.small, color: COLORS.textDim, width: 760, wrap: true },
    );
    place(meta.node, -520, -345);

    this.renderActions(root, frames, profile, pet);

    const back = createButton(root, frames, {
      text: '返回列表',
      width: 340,
      height: 72,
      variant: 'secondary',
      onClick: () => gotoScene('petList'),
    });
    place(back, -520, -480);

    // —— 右侧信息区 ——
    const statText = [
      `生命 ${stats.hp}    攻击 ${stats.atk}    防御 ${stats.def}    速度 ${stats.spd}`,
      `暴击 ${percent(stats.crit)}    暴伤 ${percent(stats.critDmg, 0)}`,
      `命中 ${signedPercent(stats.hit)}    闪避 ${percent(stats.dodge)}`,
    ].join('\n');
    this.section(root, SECTION_TITLES[0], statText, 410, 80);

    const gene = pet.genome.stats;
    const geneText = `生命 ${gene.hp}(${species.grade.hp})   攻击 ${gene.atk}(${species.grade.atk})   防御 ${gene.def}(${species.grade.def})   速度 ${gene.spd}(${species.grade.spd})`;
    this.section(root, SECTION_TITLES[1], geneText, 275, 34);

    this.section(root, SECTION_TITLES[2], this.traitText(pet), 190, 84);
    this.section(root, SECTION_TITLES[3], this.ancestryText(pet, profile), 55, 84);
    this.section(root, SECTION_TITLES[4], this.counterText(pet), -95, 84);
    this.section(root, SECTION_TITLES[5], this.skillText(pet), -235, 120);

    const hint = makeLabel(root, '数值由 deriveStats 计算；特质/相性来自配置', {
      fontSize: FONT_SIZE.small,
      color: COLORS.textDim,
    });
    place(hint.node, 260, -425);

    if (this.confirm && this.confirm.petId === pet.id) {
      showConfirm(root, frames, {
        title: '确认放生',
        body: this.confirm.body,
        confirmText: '确认放生',
        danger: true,
        onConfirm: () => void this.confirmRelease(),
        onCancel: () => {
          this.confirm = null;
          this.view?.refresh();
        },
      });
    }

    if (this.renameOpen) {
      showRenameDialog(root, frames, {
        initial: pet.name ?? '',
        onConfirm: async (newName) => {
          const result = await renamePetAction(pet.id, newName);
          if (result.ok) appStore.setToast(result.message);
          return result;
        },
        onClose: () => {
          this.renameOpen = false;
          this.view?.refresh();
        },
      });
    }

    renderToast(root, state.ui.toast, frames);
  }

  private renderActions(
    root: Node,
    frames: PlaceholderFrames,
    profile: Profile,
    pet: PetInstance,
  ): void {
    const actions: Array<{ text: string; x: number; onClick: () => void; variant: 'primary' | 'secondary' | 'danger' }> = [];

    if (pet.stage !== 'egg') {
      const inHabitat = pet.habitatId !== null;
      actions.push({
        text: inHabitat ? '移出栖息地' : '放入栖息地',
        x: -700,
        onClick: () => void this.onToggleHabitat(profile, pet, inHabitat),
        variant: 'secondary',
      });
    }

    actions.push({
      text: '改名',
      x: -460,
      onClick: () => {
        this.renameOpen = true;
        this.view?.refresh();
      },
      variant: 'secondary',
    });

    actions.push({
      text: pet.locked ? '解锁' : '锁定',
      x: -220,
      onClick: () => void this.onToggleLock(pet),
      variant: 'secondary',
    });

    const preview = previewRelease(profile, pet);
    actions.push({
      text: '放生',
      x: 20,
      onClick: () => this.onReleaseClick(pet, preview),
      variant: preview.blocked ? 'secondary' : 'danger',
    });

    actions.forEach((action) => {
      const button = createButton(root, frames, {
        text: action.text,
        width: 200,
        height: 64,
        variant: action.variant,
        onClick: action.onClick,
      });
      place(button, action.x, -390);
    });
  }

  private onReleaseClick(pet: PetInstance, preview: ReleasePreview): void {
    if (preview.blocked) {
      // 服务端模式仍发一次请求，展示服务端权威错误码（EGG_NOT_RELEASABLE/PET_LOCKED/LAST_ADULT…）；
      // 离线模式直接用 core 的同一套原因提示。
      if (appStore.getState().remote.mode === 'server') {
        void releasePetAction(pet.id).then((result) => this.view?.showToast(result.message));
      } else {
        appStore.setToast(`不可放生：${preview.reason ?? '条件不满足'}`);
      }
      return;
    }
    const refundText =
      preview.refund !== undefined ? `预计返还基因尘 ${preview.refund}（以结算为准）。` : '返还基因尘以结算为准。';
    const moveText = preview.needsMoveOut ? '会先自动移出栖息地。' : '';
    this.confirm = {
      petId: pet.id,
      body: `确定放生 ${petDisplayName(pet)} Lv.${pet.level}？
${moveText}${refundText}
放生不可撤销，图鉴“已拥有”不会回退。`,
    };
    this.view?.refresh();
  }

  private async confirmRelease(): Promise<void> {
    const petId = this.confirm?.petId;
    this.confirm = null;
    this.view?.refresh();
    if (!petId) return;
    const result = await releasePetAction(petId);
    this.view?.showToast(result.message);
  }

  private async onToggleHabitat(profile: Profile, pet: PetInstance, inHabitat: boolean): Promise<void> {
    if (inHabitat) {
      const result = await movePetAction(pet.id, null);
      this.view?.showToast(result.message);
      return;
    }
    const target = Object.values(profile.habitats).find((habitat) => habitat.slots.includes(null));
    if (!target) {
      this.view?.showToast('栖息地已满');
      return;
    }
    const result = await movePetAction(pet.id, target.id);
    this.view?.showToast(result.message);
  }

  private async onToggleLock(pet: PetInstance): Promise<void> {
    const result = await setPetLockAction(pet.id, !pet.locked);
    this.view?.showToast(result.message);
  }

  private section(root: Node, title: string, body: string, y: number, height: number): void {
    const titleLabel = makeLabel(root, title, {
      fontSize: 24,
      color: COLORS.accent,
      align: 'left',
      width: 760,
      height: 32,
      wrap: true,
    });
    place(titleLabel.node, 260, y);

    const bodyLabel = makeLabel(root, body, {
      fontSize: FONT_SIZE.small,
      color: COLORS.text,
      align: 'left',
      width: 760,
      height,
      wrap: true,
    });
    place(bodyLabel.node, 260, y - 28 - height / 2);
  }

  private traitText(pet: PetInstance): string {
    const cfg = getConfigRepo();
    const describe = (id: string): string => {
      const trait = cfg.trait(id);
      return `${trait.name}（${trait.description}）`;
    };
    const expressed = pet.traits.length > 0 ? pet.traits.map(describe).join('、') : '无';
    const hidden = pet.hiddenTraits.length > 0 ? pet.hiddenTraits.map(describe).join('、') : '无';
    return `显性：${expressed}\n隐性：${hidden}`;
  }

  private ancestryText(pet: PetInstance, profile: Profile): string {
    const nameOf = (id: string): string => {
      const found = profile.pets[id];
      return found ? petDisplayName(found) : id;
    };
    const parents = pet.parents
      .map((id) => (id ? nameOf(id) : '（无记录）'))
      .join(' / ');
    const ancestors =
      pet.ancestors.length > 0
        ? pet.ancestors.map((ref) => `${nameOf(ref.id)}(${ref.depth}代)`).join('、')
        : '无';
    return `父母：${parents}\n祖先：${ancestors}\n突变次数：${pet.genome.mutationCount}`;
  }

  private counterText(pet: PetInstance): string {
    const cfg = getConfigRepo();
    const affinityValue = cfg.affinity(pet.elementId, pet.speciesId);
    const affinityText =
      affinityValue === 1 ? '契合（+10%）' : affinityValue === -1 ? '冲突（-10%）' : '普通（0%）';

    const counters: string[] = [];
    const counteredBy: string[] = [];
    for (const other of cfg.allSpecies()) {
      if (other.id === pet.speciesId) continue;
      const forward = cfg.counterMultiplier(pet.speciesId, other.id);
      if (forward === 1.25) counters.push(`${other.name}（×1.25）`);
      const backward = cfg.counterMultiplier(other.id, pet.speciesId);
      if (backward === 1.25) counteredBy.push(`${other.name}（×0.85）`);
    }
    return [
      `相性：${affinityText}`,
      `克制：${counters.length > 0 ? counters.join('、') : '无'}`,
      `被克制：${counteredBy.length > 0 ? counteredBy.join('、') : '无'}`,
    ].join('\n');
  }

  private skillText(pet: PetInstance): string {
    const cfg = getConfigRepo();
    const slots = ['普攻', '属性小技能', '属性大招', '物种技能'];
    const ids = cfg.skillsFor(pet);
    return ids
      .map((id, index) => {
        const skill = cfg.skill(id);
        const cooldown = skill.cooldown ? `，冷却 ${skill.cooldown}` : '';
        return `${slots[index] ?? '技能'}：${skill.name}（能量 ${skill.cost}，倍率 ${skill.power}${cooldown}）`;
      })
      .join('\n');
  }
}
