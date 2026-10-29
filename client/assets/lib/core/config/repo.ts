// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 只读配置仓库（DOMAIN_MODEL §2.8、docs/CONTRACT.md §5.2、C-04）。
 *
 * 加载时用 `assertConfig` 做完整校验（结构 / 引用 / 语义 / 唯一性），失败直接抛
 * `ConfigValidationError`，不做部分加载。查询到不存在的 id 时抛带明确信息的 `Error`。
 *
 * 只读：所有 `all*()` 返回冻结副本；不做运行时热改。
 */
import { assertConfig } from './schema';
import type {
  ConfigData,
  ConfigRepo,
  ElementConfig,
  FoodConfig,
  HabitatConfig,
  PassiveConfig,
  SkillConfig,
  SpeciesConfig,
  StageConfig,
  TraitConfig,
} from './types';
import type { Affinity, CounterMultiplier, ElementId, Id } from '../types/common';
import type { PetInstance } from '../types/pet';

function indexBy<T extends { id: Id }>(items: readonly T[], table: string): ReadonlyMap<Id, T> {
  const map = new Map<Id, T>();
  for (const item of items) map.set(item.id, item);
  if (map.size !== items.length) {
    // assertConfig 已检查唯一性；到这里说明调用方绕过了校验。
    throw new Error(`@petbattle/core: 配置表 "${table}" 存在重复 id`);
  }
  return map;
}

function missing(table: string, id: Id): never {
  throw new Error(`@petbattle/core: 配置表 "${table}" 中不存在 id "${id}"`);
}

export function createConfigRepoImpl(input: ConfigData): ConfigRepo {
  const data = assertConfig(input);

  const species = indexBy<SpeciesConfig>(data.species, 'species');
  const elements = indexBy<ElementConfig>(data.elements, 'elements');
  const skills = indexBy<SkillConfig>(data.skills, 'skills');
  const passives = indexBy<PassiveConfig>(data.passives, 'passives');
  const traits = indexBy<TraitConfig>(data.traits, 'traits');
  const habitats = indexBy<HabitatConfig>(data.habitats, 'habitats');
  const foods = indexBy<FoodConfig>(data.foods, 'foods');
  const stages = indexBy<StageConfig>(data.stages, 'stages');

  const normalSkill = data.skills.find((skill) => skill.kind === 'normal');
  if (!normalSkill) {
    throw new Error('@petbattle/core: 配置缺少普攻技能（kind = "normal"）');
  }

  const affinityTable = data.affinity;

  const lookups = {
    species(id: Id): SpeciesConfig {
      return species.get(id) ?? missing('species', id);
    },
    element(id: ElementId): ElementConfig {
      return elements.get(id) ?? missing('elements', id);
    },
    skill(id: Id): SkillConfig {
      return skills.get(id) ?? missing('skills', id);
    },
    passive(id: Id): PassiveConfig {
      return passives.get(id) ?? missing('passives', id);
    },
    trait(id: Id): TraitConfig {
      return traits.get(id) ?? missing('traits', id);
    },
    habitat(id: Id): HabitatConfig {
      return habitats.get(id) ?? missing('habitats', id);
    },
    food(id: Id): FoodConfig {
      return foods.get(id) ?? missing('foods', id);
    },
    stage(id: Id): StageConfig {
      return stages.get(id) ?? missing('stages', id);
    },
    breeding() {
      return data.breeding;
    },
    economy() {
      return data.economy;
    },
    affinity(elementId: ElementId, speciesId: Id): Affinity {
      return affinityTable[elementId]?.[speciesId] ?? 0;
    },
    counterMultiplier(atkSpeciesId: Id, defSpeciesId: Id): CounterMultiplier {
      if (lookups.species(atkSpeciesId).counters.includes(defSpeciesId)) return 1.25;
      if (lookups.species(defSpeciesId).counters.includes(atkSpeciesId)) return 0.85;
      return 1;
    },
    /** [普攻, 属性小技能, 属性大招, 物种技能]。 */
    skillsFor(pet: PetInstance): Id[] {
      const element = lookups.element(pet.elementId);
      const speciesConfig = lookups.species(pet.speciesId);
      return [
        normalSkill.id,
        element.skillPool[0],
        element.skillPool[1],
        speciesConfig.signatureSkillId,
      ];
    },
    traitsFor(pet: PetInstance): TraitConfig[] {
      // 配置变更后旧存档可能带已删除的特质；这里过滤而不是抛错，避免历史档打不开。
      return pet.traits
        .map((traitId) => traits.get(traitId))
        .filter((trait): trait is TraitConfig => trait !== undefined);
    },
    allSpecies(): readonly SpeciesConfig[] {
      return Object.freeze([...data.species]);
    },
    allElements(): readonly ElementConfig[] {
      return Object.freeze([...data.elements]);
    },
    allSkills(): readonly SkillConfig[] {
      return Object.freeze([...data.skills]);
    },
    allPassives(): readonly PassiveConfig[] {
      return Object.freeze([...data.passives]);
    },
    allTraits(): readonly TraitConfig[] {
      return Object.freeze([...data.traits]);
    },
    allHabitats(): readonly HabitatConfig[] {
      return Object.freeze([...data.habitats]);
    },
    allFoods(): readonly FoodConfig[] {
      return Object.freeze([...data.foods]);
    },
    allStages(): readonly StageConfig[] {
      return Object.freeze([...data.stages]);
    },
    contentVersion: data.contentVersion,
  };

  return lookups as ConfigRepo;
}
