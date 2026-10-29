/**
 * 合成配置（D-08）：战斗/时间推进的测试不再依赖 `config/data/**` 的生产数值。
 *
 * 全部 id、数值、技能成本都是测试内固定的；D 调平衡、改水系/土系技能或关卡敌人数量时，
 * core 测试不受影响。需要测“真实数据集成”的用例（release 经济、繁殖概率）仍用 `makeRepo`。
 */
import { createConfigRepo, type ConfigData, type ConfigRepo } from '@petbattle/core';

export const SYNTHETIC_STAGE_ID = 'stage_synth';
export const SYNTHETIC_HABITAT_ID = 'meadow';
export const SYNTHETIC_NORMAL = 's_normal';
export const SYNTHETIC_SMALL = 's_small';
export const SYNTHETIC_ULT = 's_ult';
export const SYNTHETIC_ULT_COST = 75;
export const SYNTHETIC_SMALL_COST = 45;

type UnknownRecord = Record<string, unknown>;

function statBlock(
  hp: number,
  atk: number,
  def: number,
  spd: number,
  crit = 0.05,
  dodge = 0.02,
): UnknownRecord {
  return { hp, atk, def, spd, crit, critDmg: 1.5, hit: 0, dodge };
}

function species(
  id: string,
  name: string,
  base: UnknownRecord,
  signatureSkillId: string,
  counters: string[],
): UnknownRecord {
  return {
    id,
    name,
    grade: { hp: 'B', atk: 'B', def: 'B', spd: 'B' },
    base,
    growth: { hp: 0.08, atk: 0.08, def: 0.08, spd: 0.08 },
    signatureSkillId,
    counters,
    habitatTags: ['water'],
    rarity: 'common',
    breedable: true,
    spriteId: id,
  };
}

function activeSkill(id: string, cost: number, power: number, target: string): UnknownRecord {
  return { id, name: id, kind: 'active', cost, target, power, effects: [] };
}

/** 每次调用返回全新对象，避免测试间共享引用。 */
export function syntheticConfig(): UnknownRecord {
  return {
    contentVersion: 'synthetic-1',
    species: [
      species('turtle', '龟', statBlock(1000, 100, 100, 10), 's_sig_turtle', ['fish']),
      species('fish', '鱼', statBlock(800, 120, 50, 12, 0.05, 0.05), 's_sig_fish', []),
      species('frog', '蛙', statBlock(900, 90, 60, 9, 0.05, 0.04), 's_sig_frog', []),
    ],
    elements: [
      {
        id: 'water',
        name: '水',
        skillPool: [SYNTHETIC_SMALL, SYNTHETIC_ULT],
        color: '#000',
        habitatTag: 'water',
      },
      {
        id: 'fire',
        name: '火',
        skillPool: [SYNTHETIC_SMALL, SYNTHETIC_ULT],
        color: '#000',
        habitatTag: 'fire',
      },
      {
        id: 'grass',
        name: '草',
        skillPool: [SYNTHETIC_SMALL, SYNTHETIC_ULT],
        color: '#000',
        habitatTag: 'grass',
      },
      {
        id: 'earth',
        name: '土',
        skillPool: [SYNTHETIC_SMALL, SYNTHETIC_ULT],
        color: '#000',
        habitatTag: 'earth',
      },
      {
        id: 'thunder',
        name: '雷',
        skillPool: [SYNTHETIC_SMALL, SYNTHETIC_ULT],
        color: '#000',
        habitatTag: 'thunder',
      },
    ],
    affinity: {},
    skills: [
      {
        id: SYNTHETIC_NORMAL,
        name: '普攻',
        kind: 'normal',
        cost: 0,
        target: 'single',
        power: 1,
        effects: [],
      },
      activeSkill(SYNTHETIC_SMALL, SYNTHETIC_SMALL_COST, 1, 'single'),
      activeSkill(SYNTHETIC_ULT, SYNTHETIC_ULT_COST, 1.7, 'all'),
      activeSkill('s_sig_turtle', 50, 1.2, 'single'),
      activeSkill('s_sig_fish', 55, 1.1, 'all'),
      activeSkill('s_sig_frog', 60, 0.9, 'single'),
    ],
    passives: [
      { id: 'passive_synth', name: '空被动', description: '无效果。' },
    ],
    traits: [
      {
        id: 'trait_synth',
        name: '合成特质',
        rarity: 'common',
        description: '攻击 +10%。',
        statMods: { atk: 1.1 },
        inheritance: { weight: 0.5 },
      },
    ],
    habitats: [
      {
        id: SYNTHETIC_HABITAT_ID,
        name: '草甸',
        capacity: 4,
        elementBonus: { water: 0.15, grass: 0.15, earth: 0.1 },
        productionPerHour: [
          { resource: 'coin', amountPerHour: 12 },
          { resource: 'food', amountPerHour: 6 },
          { resource: 'geneDust', amountPerHour: 1 },
        ],
        upkeepPerPetPerHour: [{ resource: 'food', amountPerHour: 1 }],
        conditionDecayPerHour: { hunger: 3, mood: 2, hygiene: 2 },
        healthDecayWhenStarving: 2,
        healthRecoveryPerHour: 4,
        offlineCapMs: 28_800_000,
        decayCapMs: 86_400_000,
        upgrade: {
          maxLevel: 3,
          levels: [
            { level: 1, cost: [], capacity: 4, productionMul: 1 },
            {
              level: 2,
              cost: [
                { resource: 'coin', amount: 500 },
                { resource: 'geneDust', amount: 20 },
              ],
              capacity: 5,
              productionMul: 1.15,
            },
            {
              level: 3,
              cost: [
                { resource: 'coin', amount: 1500 },
                { resource: 'geneDust', amount: 60 },
              ],
              capacity: 6,
              productionMul: 1.3,
            },
          ],
        },
      },
    ],
    foods: [
      {
        id: 'kibble',
        name: '合成粮',
        cost: [{ resource: 'coin', amount: 10 }],
        nutrition: 25,
        mood: 5,
      },
    ],
    breeding: {
      hatchMs: 1_800_000,
      juvenileMs: 7_200_000,
      elderAfterMs: 604_800_000,
      cooldownMs: 7_200_000,
      cost: [
        { resource: 'coin', amount: 100 },
        { resource: 'food', amount: 20 },
      ],
      mutation: { geneSigma: 8, traitChance: 0.03, elementChance: 0.01 },
      inbreeding: {
        generations: 3,
        genePenalty: 5,
        mutationBonus: 0.02,
        fertilityPenalty: 0.2,
      },
      maxExpressedTraits: 3,
      maxHiddenTraits: 3,
    },
    stages: [
      {
        id: SYNTHETIC_STAGE_ID,
        name: '合成关',
        order: 1,
        enemies: [
          { speciesId: 'frog', elementId: 'water', level: 1, geneQuality: 50, traits: [] },
          { speciesId: 'fish', elementId: 'water', level: 1, geneQuality: 50, traits: [] },
        ],
        rewards: {
          firstClear: { resources: { coin: 10 }, petExp: 10 },
          repeat: { resources: { coin: 3 }, petExp: 3 },
        },
      },
    ],
    economy: {
      startingResources: { coin: 1000, food: 100, geneDust: 10 },
      releaseRefund: {
        base: 5,
        perLevel: 2,
        perGeneSumDivisor: 10,
        rarityBonus: { common: 1, rare: 3, epic: 8 },
      },
      resourceCaps: { coin: 999999, food: 9999, geneDust: 99999 },
    },
  };
}

export type SyntheticMutator = (config: UnknownRecord) => void;

export function makeSyntheticRepo(mutate?: SyntheticMutator): ConfigRepo {
  const config = syntheticConfig();
  if (mutate) mutate(config);
  return createConfigRepo(config as unknown as ConfigData);
}
