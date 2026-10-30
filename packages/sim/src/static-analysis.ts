/**
 * 配置口径的静态分析：不调用 core 的派生/战斗公式，只做“内容自洽性”检查。
 *
 * 目的：A 的 core 尚未实现时，也能提前发现关卡经验、经济、特质分布上的硬伤
 * （P-033 经验闭环、P-106 schema 漂移、P-108 经济死锁）。
 */
import type { ConfigData, ElementId, ResourceId } from '@petbattle/core';
import {
  MVP_SPECIES_IDS,
  REPEAT_EXP_DIVISOR,
  STAGE_EXP_BASE,
  STAGE_EXP_PER_ORDER,
} from '@petbattle/core';

import type { SimCheck, StaticAnalysis } from './types.js';

const EXPECTED_TRAIT_WEIGHT: Record<'common' | 'rare' | 'epic', number> = {
  common: 0.5,
  rare: 0.25,
  epic: 0.1,
};

const RESOURCES: ResourceId[] = ['coin', 'food', 'geneDust', 'premium'];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sumRates(rates: ReadonlyArray<{ resource: ResourceId; amountPerHour: number }>, resource: ResourceId): number {
  return rates.filter((rate) => rate.resource === resource).reduce((sum, rate) => sum + rate.amountPerHour, 0);
}

function topElementBonus(bonus: Partial<Record<ElementId, number>>, slots: number): number {
  return Object.values(bonus)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => b - a)
    .slice(0, slots)
    .reduce((sum, value) => sum + value, 0);
}

export function analyzeConfig(data: ConfigData): StaticAnalysis {
  const checks: SimCheck[] = [];
  const notes: string[] = [];

  const habitat = data.habitats[0];
  if (!habitat) throw new Error('配置缺少栖息地，无法做经济分析');

  const traitsByRarity = { common: 0, rare: 0, epic: 0 };
  for (const trait of data.traits) traitsByRarity[trait.rarity] += 1;

  // --- 特质 ---------------------------------------------------------------
  if (data.traits.length >= 15 && data.traits.length <= 20) {
    checks.push({
      id: 'traits.count',
      level: 'pass',
      detail: `特质 ${data.traits.length} 条，落在 15~20 的目标区间。`,
    });
  } else {
    checks.push({
      id: 'traits.count',
      level: 'fail',
      detail: `特质 ${data.traits.length} 条，PRD §13.3 要求 15~20 条。`,
    });
  }

  for (const trait of data.traits) {
    const expected = EXPECTED_TRAIT_WEIGHT[trait.rarity];
    if (trait.inheritance.weight !== expected) {
      checks.push({
        id: `traits.weight.${trait.id}`,
        level: 'warn',
        detail: `稀有度 ${trait.rarity} 的继承权重应为 ${expected}，实际 ${trait.inheritance.weight}。`,
      });
    }
    if (trait.statMods && 'hit' in trait.statMods) {
      const hit = trait.statMods.hit ?? 0;
      const ok = hit >= 0.02 && hit <= 0.05;
      checks.push({
        id: `traits.hit.${trait.id}`,
        level: ok ? 'pass' : 'warn',
        detail: ok
          ? `${trait.id} 用加法修正 hit=${hit}（0.02~0.05，contract-v1.3 D-13）。`
          : `${trait.id} 的 hit=${hit} 不在 0.02~0.05 加法量级，可能被 clamp 或当成乘数。`,
      });
    }
  }
  checks.push({
    id: 'traits.rarity',
    level: traitsByRarity.common > 0 && traitsByRarity.rare > 0 && traitsByRarity.epic > 0 ? 'pass' : 'fail',
    detail: `稀有度分布 common=${traitsByRarity.common} / rare=${traitsByRarity.rare} / epic=${traitsByRarity.epic}。`,
  });

  // --- 关卡经验（P-033） ---------------------------------------------------
  const stageExp = [...data.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const firstClear = stage.rewards.firstClear?.petExp ?? 0;
      const repeat = stage.rewards.repeat?.petExp ?? 0;
      const expectedFirst = STAGE_EXP_BASE + stage.order * STAGE_EXP_PER_ORDER;
      const expectedRepeat = Math.floor(expectedFirst / REPEAT_EXP_DIVISOR);
      const ok = firstClear === expectedFirst && repeat === expectedRepeat;
      checks.push({
        id: `stage.exp.${stage.id}`,
        level: ok ? 'pass' : 'fail',
        detail: ok
          ? `${stage.id}: 首通 ${firstClear} / 重复 ${repeat}，符合 30+order×10 与 floor(首通/3)。`
          : `${stage.id}: 首通 ${firstClear}（应为 ${expectedFirst}）/ 重复 ${repeat}（应为 ${expectedRepeat}）。`,
      });
      return { stageId: stage.id, order: stage.order, firstClear, repeat, expectedFirst, expectedRepeat };
    });

  // 奖励模板（contract-v1.5 E-05）：首通 pets 是蛋模板；repeat 不发宠物。
  const eggToAdultHours = (data.breeding.hatchMs + data.breeding.juvenileMs) / 3_600_000;
  checks.push({
    id: 'rewards.egg.timing',
    level: eggToAdultHours <= 3 ? 'pass' : 'warn',
    detail: `首通蛋 ${data.breeding.hatchMs / 60_000}min 孵化 + ${data.breeding.juvenileMs / 3_600_000}h 幼年 = ${eggToAdultHours}h 到成年。`,
  });
  const firstClearPets: string[] = [];
  for (const stage of data.stages) {
    const first = stage.rewards.firstClear;
    const repeat = stage.rewards.repeat;
    if (repeat && ((repeat.pets?.length ?? 0) > 0 || (repeat.eggs?.length ?? 0) > 0)) {
      checks.push({
        id: `rewards.repeat.pets.${stage.id}`,
        level: 'fail',
        detail: `${stage.id} 的重复奖励含宠物/蛋；按 E-03 重复只发资源与经验。`,
      });
    }
    if (first?.eggs && first.eggs.length > 0) {
      checks.push({
        id: `rewards.eggs.${stage.id}`,
        level: 'warn',
        detail: `${stage.id} 使用 rewards.eggs；MVP 约定用 pets 蛋模板（E-05）。`,
      });
    }
    for (const pet of first?.pets ?? []) {
      const speciesOk = data.species.some((species) => species.id === pet.speciesId);
      const elementOk = data.elements.some((element) => element.id === pet.elementId);
      const mvpOk = MVP_SPECIES_IDS.includes(pet.speciesId as (typeof MVP_SPECIES_IDS)[number]);
      if (!speciesOk || !elementOk || !mvpOk) {
        checks.push({
          id: `rewards.firstClear.pet.${stage.id}`,
          level: 'fail',
          detail: `${stage.id} 首通蛋模板 ${pet.speciesId}/${pet.elementId} 不存在或非 MVP 物种。`,
        });
      } else {
        firstClearPets.push(`${stage.id}: ${pet.speciesId}/${pet.elementId}`);
      }
    }
  }
  if (firstClearPets.length > 0) {
    notes.push(
      `首通宠物（蛋阶段交付）：${firstClearPets.join('、')}；${eggToAdultHours}h 到成年，可与“首通→孵化→繁殖”主循环衔接。`,
    );
  }

  // 难度曲线：敌方等级与基因质量应单调不减。
  const ordered = [...data.stages].sort((a, b) => a.order - b.order);
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!prev || !cur) continue;
    const avg = (list: { level: number }[]): number =>
      list.reduce((sum, item) => sum + item.level, 0) / Math.max(1, list.length);
    const avgGene = (list: { geneQuality: number }[]): number =>
      list.reduce((sum, item) => sum + item.geneQuality, 0) / Math.max(1, list.length);
    if (avg(cur.enemies) < avg(prev.enemies) || avgGene(cur.enemies) < avgGene(prev.enemies)) {
      checks.push({
        id: `stage.curve.${cur.id}`,
        level: 'warn',
        detail: `${cur.id} 的敌方等级/基因低于前一关，难度曲线不单调。`,
      });
    }
    for (const enemy of cur.enemies) {
      if (!MVP_SPECIES_IDS.includes(enemy.speciesId as (typeof MVP_SPECIES_IDS)[number])) {
        checks.push({
          id: `stage.species.${cur.id}`,
          level: 'fail',
          detail: `${cur.id} 使用了非 MVP 物种 ${enemy.speciesId}。`,
        });
      }
    }
  }

  // --- 经济 ---------------------------------------------------------------
  const cap = habitat.upgrade.levels[0]?.capacity ?? habitat.capacity;
  const bonus = topElementBonus(habitat.elementBonus, cap);
  const elementMul = 1 + bonus;
  const coinPerHour = sumRates(habitat.productionPerHour, 'coin') * elementMul;
  const foodProduced = sumRates(habitat.productionPerHour, 'food') * elementMul;
  const foodUpkeep = sumRates(habitat.upkeepPerPetPerHour, 'food') * cap;
  const geneDustPerHour = sumRates(habitat.productionPerHour, 'geneDust') * elementMul;
  const foodNetPerHourAtCapacity = foodProduced - foodUpkeep;

  const breedingCoin = data.breeding.cost
    .filter((item) => item.resource === 'coin')
    .reduce((sum, item) => sum + item.amount, 0);
  const breedingFood = data.breeding.cost
    .filter((item) => item.resource === 'food')
    .reduce((sum, item) => sum + item.amount, 0);

  const firstClearCoinTotal = data.stages.reduce(
    (sum, stage) => sum + (stage.rewards.firstClear?.resources?.coin ?? 0),
    0,
  );
  const firstClearDustTotal = data.stages.reduce(
    (sum, stage) => sum + (stage.rewards.firstClear?.resources?.geneDust ?? 0),
    0,
  );

  const upgrade2 = habitat.upgrade.levels[1];
  const upgrade2Coin = upgrade2?.cost.filter((item) => item.resource === 'coin').reduce((s, i) => s + i.amount, 0) ?? 0;
  const upgrade2Dust =
    upgrade2?.cost.filter((item) => item.resource === 'geneDust').reduce((s, i) => s + i.amount, 0) ?? 0;

  const refund = data.economy.releaseRefund;
  const minGeneSum = 4 * 50;
  const maxGeneSum = 4 * 100;
  const minReleaseDust = Math.max(1, Math.floor(refund.base + refund.perLevel + minGeneSum / refund.perGeneSumDivisor + refund.rarityBonus.common));
  const maxReleaseDust = Math.max(
    1,
    Math.floor(refund.base + 20 * refund.perLevel + maxGeneSum / refund.perGeneSumDivisor + refund.rarityBonus.epic * 3),
  );

  const starting = data.economy.startingResources;
  const startingCoin = starting.coin ?? 0;
  const startingFood = starting.food ?? 0;
  const startingGeneDust = starting.geneDust ?? 0;

  const pushEconomyCheck = (id: string, ok: boolean, detail: string): void => {
    checks.push({ id, level: ok ? 'pass' : 'warn', detail });
  };

  pushEconomyCheck(
    'economy.start.breeding',
    startingCoin >= breedingCoin && startingFood >= breedingFood,
    `初始 ${startingCoin} 金币 / ${startingFood} 食物，首次繁殖 ${breedingCoin} 金币 + ${breedingFood} 食物。`,
  );
  pushEconomyCheck(
    'economy.food.net',
    foodNetPerHourAtCapacity > 0,
    `满容量（${cap} 只）食物净产出 ${round(foodNetPerHourAtCapacity)}/h（产出 ${round(foodProduced)} − 消耗 ${round(foodUpkeep)}）。`,
  );
  pushEconomyCheck(
    'economy.coin.net',
    coinPerHour > 0 && geneDustPerHour > 0,
    `满容量金币 ${round(coinPerHour)}/h、基因尘 ${round(geneDustPerHour)}/h。`,
  );
  pushEconomyCheck(
    'economy.upgrade.reachable',
    firstClearCoinTotal >= upgrade2Coin && firstClearDustTotal >= upgrade2Dust,
    `五关首通合计 ${firstClearCoinTotal} 金币 / ${firstClearDustTotal} 基因尘，二级栖息地需要 ${upgrade2Coin} / ${upgrade2Dust}。`,
  );
  pushEconomyCheck(
    'economy.release.positive',
    minReleaseDust >= 1 && maxReleaseDust > minReleaseDust,
    `放生返还区间 ${minReleaseDust}~${maxReleaseDust} 基因尘；地板 1，不会出现 0 收益。`,
  );

  for (const resource of RESOURCES) {
    const value = starting[resource];
    const limit = data.economy.resourceCaps?.[resource];
    if (value !== undefined && limit !== undefined && value > limit) {
      checks.push({
        id: `economy.cap.${resource}`,
        level: 'fail',
        detail: `初始 ${resource}=${value} 超过上限 ${limit}。`,
      });
    }
  }

  // --- 补充说明 -----------------------------------------------------------
  notes.push(`图鉴组合 = ${data.species.length} 物种 × ${data.elements.length} 属性 = ${data.species.length * data.elements.length}。`);
  notes.push(
    `继承权重当前未被 DOMAIN §8.2 的遗传算法消费；若要让稀有特质更稀有，需要 A 在突变抽取时按 weight 加权（见 docs/BALANCE.md §7）。`,
  );

  const codexCombos = data.species.length * data.elements.length;

  return {
    contentVersion: data.contentVersion,
    counts: {
      species: data.species.length,
      elements: data.elements.length,
      skills: data.skills.length,
      passives: data.passives.length,
      traits: data.traits.length,
      habitats: data.habitats.length,
      foods: data.foods.length,
      stages: data.stages.length,
      codexCombos,
    },
    traitsByRarity,
    stageExp,
    economy: {
      startingCoin,
      startingFood,
      startingGeneDust,
      breedingCoin,
      breedingFood,
      foodNetPerHourAtCapacity: round(foodNetPerHourAtCapacity),
      coinPerHourAtCapacity: round(coinPerHour),
      geneDustPerHourAtCapacity: round(geneDustPerHour),
      firstClearCoinTotal,
      firstClearDustTotal,
      upgrade2Coin,
      upgrade2Dust,
      minReleaseDust,
      maxReleaseDust,
    },
    checks,
    notes,
  };
}
