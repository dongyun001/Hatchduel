import { _decorator, Component, type Node } from 'cc';
import { gotoScene } from './navigation';
import type { AppState } from './store';
import { getConfigRepo } from '../services/config';
import { deriveStats } from '../../lib/core';
import type { PetInstance, Profile } from '../../lib/core';
import { COLORS, DESIGN, FONT_SIZE } from '../ui/theme';
import { makeButton, makeLabel, makeSprite, place } from '../ui/nodes';
import { createTitle, elementName, elementTint, genderMark, speciesName, stageName } from '../ui/screens';
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
 * PetDetail：八项派生属性（deriveStats）、基因、显性/隐性特质、血统、相性/克制、技能列表。
 * 所有数值来自 core / 配置，不在客户端重算公式。
 */
@ccclass('PetDetailController')
export class PetDetailController extends Component {
  private view: SceneView | null = null;

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

    if (!profile || !pet) {
      const empty = makeLabel(root, '没有选中的宠物', { fontSize: FONT_SIZE.body, color: COLORS.danger });
      place(empty.node, 0, 40);
      const back = makeButton(root, '返回列表', 360, 84, frames.white, () => gotoScene('petList'));
      place(back, 0, -80);
      return;
    }

    const cfg = getConfigRepo();
    const stats = deriveStats(pet, cfg);
    const species = cfg.species(pet.speciesId);

    const portrait = makeSprite(root, frames.portrait, 256 * DESIGN.pixelScale, 256 * DESIGN.pixelScale, elementTint(pet.elementId));
    place(portrait.node, -520, 80);

    const name = makeLabel(root, `${speciesName(pet.speciesId)} ${genderMark(pet.gender)}`, {
      fontSize: 36,
      color: COLORS.text,
    });
    place(name.node, -520, -340);

    const meta = makeLabel(
      root,
      `${elementName(pet.elementId)}属性 · ${stageName(pet.stage)} · Lv.${pet.level} · 世代 ${pet.generation}`,
      { fontSize: FONT_SIZE.body, color: COLORS.textDim },
    );
    place(meta.node, -520, -388);

    const back = makeButton(root, '返回列表', 340, 72, frames.white, () => gotoScene('petList'));
    place(back, -520, -475);

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

    if (state.ui.toast) {
      const toast = makeLabel(root, state.ui.toast, { fontSize: FONT_SIZE.body, color: COLORS.accent, width: 1500, wrap: true });
      place(toast.node, 0, -490);
    }
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
    const cfg = getConfigRepo();
    const nameOf = (id: string): string => {
      const found = profile.pets[id];
      return found ? cfg.species(found.speciesId).name : id;
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
