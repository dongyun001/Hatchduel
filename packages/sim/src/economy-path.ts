/**
 * 真实玩家路径：每 8 小时上线一次，包含喂养、陪玩、清洁、繁殖、栖息地升级支出。
 *
 * 与 `runEconomyCurve`（只产出）互补：本函数用来检查“有支出时会不会亏空/死锁”。
 * 喂养/陪玩/清洁/升级走 core；繁殖因 `startBreeding` 尚未实现（contract-v1.4 D-17），
 * 按 `breeding.cost` 手工扣费并用 `breed` 生成子代。
 */
import {
  advanceProfile,
  breed,
  cleanPet,
  collectHabitat,
  expToNext,
  feedPet,
  playWithPet,
  upgradeHabitat,
  type ConfigData,
  type ConfigRepo,
  type EpochMs,
  type Profile,
  type ResourceBag,
  type ResourceCost,
  type ResourceId,
} from '@petbattle/core';

import { makeSimProfile } from './fixtures.js';
import { createRng } from './rng.js';
import type { PlayerPathCurve, PlayerPathPoint, SimStatus } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const OFFLINE_CAP_MS = 8 * HOUR_MS;
const RESOURCES: ResourceId[] = ['coin', 'food', 'geneDust', 'premium'];

const PATH_NOTES = [
  '路径假设：每天 3 次上线（每 8 小时），每次打 4 场、共 12 场/天，每次领取产出后照料一次。',
  '战斗按“全部通关”的乐观路径计入首通/重复奖励（未按胜率折算）。',
  '刷关路径：D1 第1关×12；D2 第1关×5+第2关×7；D3 第3关×12；D4 第4关×12；D5 第4关×2+第5关×10；D6-7 第5关×12。对应首通等级 1/4/5/7/9。',
  '喂养：饥饿 <50 时喂 1 个野果（10 金币，+25 饥饿/+5 心情）；陪玩/清洁在心情/清洁 <60 时各一次。',
  '繁殖：第 2 天起每天 1 次（100 金币 + 20 食物）；startBreeding 尚未实现（D-17），按配置手工扣费。',
  '栖息地升级：金币/基因尘足够时立刻升下一级（走 core upgradeHabitat 扣费）。',
  '首通奖励宠物不计入栖息地/产出；蛋不占维护。',
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 每天 12 场（3 次上线 × 每次 4 场）的刷关路径；首通等级对齐战斗模拟的 1/4/5/7/9。 */
function battlePlan(day: number): string[] {
  const repeat = (stageId: string, count: number): string[] => Array<string>(count).fill(stageId);
  switch (day) {
    case 1:
      return repeat('stage_1', 12);
    case 2:
      return [...repeat('stage_1', 5), ...repeat('stage_2', 7)];
    case 3:
      return repeat('stage_3', 12);
    case 4:
      return repeat('stage_4', 12);
    case 5:
      return [...repeat('stage_4', 2), ...repeat('stage_5', 10)];
    default:
      return repeat('stage_5', 12);
  }
}

function canAfford(profile: Profile, cost: readonly ResourceCost[]): boolean {
  return cost.every((item) => (profile.currencies[item.resource] ?? 0) >= item.amount);
}

function spend(profile: Profile, cost: readonly ResourceCost[]): void {
  for (const item of cost) {
    profile.currencies[item.resource] = (profile.currencies[item.resource] ?? 0) - item.amount;
  }
}

function coinCost(cost: readonly ResourceCost[]): number {
  return cost.filter((item) => item.resource === 'coin').reduce((sum, item) => sum + item.amount, 0);
}

function addBag(target: Record<ResourceId, number>, bag: ResourceBag | undefined): void {
  if (!bag) return;
  for (const resource of RESOURCES) {
    const amount = bag[resource] ?? 0;
    if (amount !== 0) target[resource] = (target[resource] ?? 0) + amount;
  }
}

function sumStored(profile: Profile): Record<'coin' | 'food' | 'geneDust', number> {
  const out = { coin: 0, food: 0, geneDust: 0 };
  for (const habitat of Object.values(profile.habitats)) {
    out.coin += habitat.stored.coin ?? 0;
    out.food += habitat.stored.food ?? 0;
    out.geneDust += habitat.stored.geneDust ?? 0;
  }
  return out;
}

function levelFromExp(total: number): { level: number; exp: number } {
  let level = 1;
  let exp = total;
  while (level < 20 && exp >= expToNext(level)) {
    exp -= expToNext(level);
    level += 1;
  }
  return { level, exp };
}

function avgCondition(profile: Profile, key: 'hunger' | 'mood' | 'hygiene'): number {
  const pets = Object.values(profile.pets).filter((pet) => pet.stage !== 'egg');
  if (pets.length === 0) return 0;
  return round(pets.reduce((sum, pet) => sum + pet.condition[key], 0) / pets.length);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function unavailablePlayerPath(reason: string, days: number): PlayerPathCurve {
  return {
    status: 'unavailable' as SimStatus,
    reason,
    days,
    points: [],
    dayEnd: [],
    expenses: { feedCoin: 0, breedCoin: 0, breedFood: 0, upgradeCoin: 0, upgradeGeneDust: 0 },
    income: {
      stageCoin: 0,
      stageFood: 0,
      stageGeneDust: 0,
      producedCoin: 0,
      producedFood: 0,
      producedGeneDust: 0,
    },
    totalExp: 0,
    finalLevel: 1,
    notes: PATH_NOTES,
  };
}

export function runPlayerPathCurve(cfg: ConfigRepo, data: ConfigData, days: number): PlayerPathCurve {
  try {
    const fixture = makeSimProfile(cfg, data, 0);
    let profile = fixture.profile;
    const habitatId = fixture.habitatId;
    const habitatConfig = data.habitats[0];
    if (!habitatConfig) throw new Error('配置缺少栖息地');
    const berry = data.foods.find((food) => food.id === 'berry') ?? data.foods[0];
    if (!berry) throw new Error('配置缺少食物');

    const rng = createRng(20261029);
    const points: PlayerPathPoint[] = [];
    const expenses = { feedCoin: 0, breedCoin: 0, breedFood: 0, upgradeCoin: 0, upgradeGeneDust: 0 };
    const income = {
      stageCoin: 0,
      stageFood: 0,
      stageGeneDust: 0,
      producedCoin: 0,
      producedFood: 0,
      producedGeneDust: 0,
    };
    const cleared = new Set<string>();
    let totalExp = 0;
    let breeds = 0;
    let feeds = 0;

    for (let day = 1; day <= days; day += 1) {
      const plan = battlePlan(day);
      for (let session = 0; session < 3; session += 1) {
        const now: EpochMs = ((day - 1) * 3 + session + 1) * OFFLINE_CAP_MS;
        profile = advanceProfile(profile, now, cfg).profile;

        // 1. 关卡奖励（乐观：全通关；每 session 4 场）
        for (const stageId of plan.slice(session * 4, session * 4 + 4)) {
          const stage = data.stages.find((item) => item.id === stageId);
          if (!stage) continue;
          const reward = cleared.has(stageId) ? stage.rewards.repeat : stage.rewards.firstClear;
          addBag(profile.currencies, reward?.resources);
          income.stageCoin += reward?.resources?.coin ?? 0;
          income.stageFood += reward?.resources?.food ?? 0;
          income.stageGeneDust += reward?.resources?.geneDust ?? 0;
          totalExp += reward?.petExp ?? 0;
          cleared.add(stageId);
        }

        // 2. 领取产出
        const before = sumStored(profile);
        profile = collectHabitat(profile, habitatId, now, cfg).profile;
        const after = sumStored(profile);
        income.producedCoin += before.coin - after.coin;
        income.producedFood += before.food - after.food;
        income.producedGeneDust += before.geneDust - after.geneDust;

        // 3. 照料：喂/陪玩/清洁
        const slotIds = (profile.habitats[habitatId]?.slots ?? []).filter(
          (id): id is string => typeof id === 'string',
        );
        for (const petId of slotIds) {
          const pet = profile.pets[petId];
          if (!pet || pet.stage === 'egg') continue;
          if (pet.condition.hunger < 50 && canAfford(profile, berry.cost)) {
            profile = feedPet(profile, petId, berry.id, now, cfg).profile;
            expenses.feedCoin += coinCost(berry.cost);
            feeds += 1;
          }
          const afterFeed = profile.pets[petId];
          if (!afterFeed) continue;
          if (afterFeed.condition.mood < 60) {
            profile = playWithPet(profile, petId, now, cfg).profile;
          }
          const afterPlay = profile.pets[petId];
          if (!afterPlay) continue;
          if (afterPlay.condition.hygiene < 60) {
            profile = cleanPet(profile, petId, now, cfg).profile;
          }
        }

        // 4. 每天繁殖 1 次（第 2 天起）
        if (session === 0 && day >= 2) {
          const father = profile.pets['sim_pet_0'];
          const mother = profile.pets['sim_pet_1'];
          if (father && mother && canAfford(profile, data.breeding.cost)) {
            const child = breed(father, mother, now, cfg, rng).child;
            spend(profile, data.breeding.cost);
            for (const item of data.breeding.cost) {
              if (item.resource === 'coin') expenses.breedCoin += item.amount;
              if (item.resource === 'food') expenses.breedFood += item.amount;
            }
            breeds += 1;
            profile = {
              ...profile,
              pets: { ...profile.pets, [child.id]: child },
              breeding: { ...profile.breeding, eggs: [...profile.breeding.eggs, child.id] },
            };
          }
        }

        // 5. 栖息地升级：够钱就升下一级
        const currentHabitat = profile.habitats[habitatId];
        if (currentHabitat) {
          const nextLevel = habitatConfig.upgrade.levels.find(
            (level) => level.level === currentHabitat.level + 1,
          );
          if (nextLevel && canAfford(profile, nextLevel.cost)) {
            for (const item of nextLevel.cost) {
              if (item.resource === 'coin') expenses.upgradeCoin += item.amount;
              if (item.resource === 'geneDust') expenses.upgradeGeneDust += item.amount;
            }
            profile = upgradeHabitat(profile, habitatId, now, cfg).profile;
          }
        }

        const { level, exp } = levelFromExp(totalExp);
        const point: PlayerPathPoint = {
          day,
          hour: ((day - 1) * 3 + session + 1) * 8,
          coin: profile.currencies.coin ?? 0,
          food: profile.currencies.food ?? 0,
          geneDust: profile.currencies.geneDust ?? 0,
          level,
          exp,
          habitatLevel: profile.habitats[habitatId]?.level ?? 1,
          breeds,
          feeds,
          avgHunger: avgCondition(profile, 'hunger'),
          avgMood: avgCondition(profile, 'mood'),
          avgHygiene: avgCondition(profile, 'hygiene'),
        };
        if (!Number.isFinite(point.coin) || !Number.isFinite(point.food) || !Number.isFinite(point.geneDust)) {
          throw new Error(`玩家路径出现非有限数值（day=${day}, session=${session}）`);
        }
        points.push(point);
      }
    }

    const dayEnd = points.filter((point) => point.hour > 0 && point.hour % 24 === 0);
    const { level: finalLevel } = levelFromExp(totalExp);
    return {
      status: 'ok',
      days,
      points,
      dayEnd,
      expenses,
      income,
      totalExp,
      finalLevel,
      notes: PATH_NOTES,
    };
  } catch (error) {
    return unavailablePlayerPath(describeError(error), days);
  }
}
