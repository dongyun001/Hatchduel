/**
 * 7 天资源曲线：每 8 小时推进一次（离线封顶），每次推进后模拟“玩家领取”。
 *
 * 产出/衰减/阶段推进全部走 core 的 `advanceProfile`；sim 只做时间步进与领取，
 * 不重复实现公式（避免与 core 漂移）。core 未实现时返回 `unavailable`。
 */
import {
  CoreNotImplementedError,
  advanceProfile,
  type ConfigData,
  type ConfigRepo,
  type EpochMs,
  type Profile,
  type ResourceId,
} from '@petbattle/core';

import { makeSimProfile } from './fixtures.js';
import type { EconomyCurve, EconomyPoint } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const OFFLINE_CAP_MS = 8 * HOUR_MS;
const RESOURCES: ResourceId[] = ['coin', 'food', 'geneDust', 'premium'];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function unavailableEconomy(reason: string, days: number): EconomyCurve {
  return {
    status: 'unavailable',
    reason,
    days,
    points: [],
    dayEnd: [],
    totalCoin: 0,
    totalFood: 0,
    totalGeneDust: 0,
    offlineCapRatio: 0,
    offlineCapVerified: false,
    hasNegativeValues: false,
  };
}

function describeError(error: unknown): string {
  if (error instanceof CoreNotImplementedError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function claimAll(profile: Profile): Profile {
  for (const habitat of Object.values(profile.habitats)) {
    for (const resource of RESOURCES) {
      const amount = habitat.stored[resource] ?? 0;
      if (amount > 0) {
        profile.currencies[resource] = (profile.currencies[resource] ?? 0) + amount;
      }
    }
    habitat.stored = {};
  }
  return profile;
}

function snapshot(profile: Profile, hour: number): EconomyPoint {
  const pets = Object.values(profile.pets);
  const avg = (pick: (pet: (typeof pets)[number]) => number): number =>
    pets.length === 0 ? 0 : pets.reduce((sum, pet) => sum + pick(pet), 0) / pets.length;
  const storedCoin = Object.values(profile.habitats).reduce(
    (sum, habitat) => sum + (habitat.stored.coin ?? 0),
    0,
  );

  return {
    hour,
    coin: profile.currencies.coin ?? 0,
    food: profile.currencies.food ?? 0,
    geneDust: profile.currencies.geneDust ?? 0,
    storedCoin,
    avgHunger: round(avg((pet) => pet.condition.hunger)),
    avgHealth: round(avg((pet) => pet.condition.health)),
  };
}

export function runEconomyCurve(
  cfg: ConfigRepo,
  data: ConfigData,
  days: number,
): EconomyCurve {
  try {
    const fixture = makeSimProfile(cfg, data, 0);
    let profile: Profile = fixture.profile;

    const points: EconomyPoint[] = [snapshot(profile, 0)];
    const totalTicks = days * 3;

    for (let tick = 1; tick <= totalTicks; tick += 1) {
      const now: EpochMs = tick * OFFLINE_CAP_MS;
      profile = advanceProfile(profile, now, cfg).profile;
      profile = claimAll(profile);
      const point = snapshot(profile, tick * 8);
      if (
        !Number.isFinite(point.coin) ||
        !Number.isFinite(point.food) ||
        !Number.isFinite(point.geneDust) ||
        !Number.isFinite(point.avgHunger)
      ) {
        throw new Error(`资源曲线出现非有限数值（tick=${tick}）`);
      }
      points.push(point);
    }

    const dayEnd = points.filter((point) => point.hour > 0 && point.hour % 24 === 0);
    const last = points[points.length - 1] ?? snapshot(profile, 0);

    // 离线封顶：24h 单次推进的产出应约等于 8h（core 按 offlineCapMs 截断），而不是 3 倍。
    const eightHour = producedAfter(cfg, data, 8);
    const day = producedAfter(cfg, data, 24);
    const offlineCapRatio = eightHour > 0 ? day / eightHour : 0;
    const offlineCapVerified = eightHour > 0 && offlineCapRatio > 0.5 && offlineCapRatio < 1.2;

    const hasNegativeValues = points.some(
      (point) => point.coin < 0 || point.food < 0 || point.geneDust < 0 || point.avgHunger < 0,
    );

    return {
      status: 'ok',
      days,
      points,
      dayEnd,
      totalCoin: last.coin,
      totalFood: last.food,
      totalGeneDust: last.geneDust,
      offlineCapRatio: round(offlineCapRatio, 3),
      offlineCapVerified,
      hasNegativeValues,
    };
  } catch (error) {
    return unavailableEconomy(describeError(error), days);
  }
}

/** 单次推进 `hours` 后，栖息地里未领取的产出金币；用于验证离线封顶。 */
function producedAfter(cfg: ConfigRepo, data: ConfigData, hours: number): number {
  const fixture = makeSimProfile(cfg, data, 0);
  const advanced = advanceProfile(fixture.profile, hours * HOUR_MS, cfg).profile;
  return Object.values(advanced.habitats).reduce(
    (sum, habitat) => sum + (habitat.stored.coin ?? 0),
    0,
  );
}
