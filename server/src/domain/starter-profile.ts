/**
 * 新账号的初始存档。
 *
 * 这是**结构完整但内容为空**的骨架：初始 3 只宠物、初始资源属于领域规则（PRD §5.5），
 * 必须由 `@petbattle/core` 的工厂函数生成，服务端不得自己写一套（PITFALLS P-030 同类问题）。
 * A 交付 initial-profile 工厂后，这里改成调用 core 即可；届时只需保证 `revision = 0`。
 */
import type { EpochMs, Profile } from '@petbattle/core';

/** 存档结构版本；结构变更时 +1 并补迁移（ONLINE_DESIGN §4.4）。 */
export const PROFILE_STRUCTURE_VERSION = 1;

/** PvP 初始分；段位细则待 D/C 定（CONTRACT §10.3），先给中性初值。 */
export const STARTING_PVP_RATING = 1000;

export const PRESEASON_ID = 'preseason';

export function createInitialProfile(accountId: string, now: EpochMs): Profile {
  return {
    version: PROFILE_STRUCTURE_VERSION,
    accountId,
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: { coin: 0, food: 0, geneDust: 0, premium: 0 },
    pets: {},
    habitats: {},
    codex: {},
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: STARTING_PVP_RATING, seasonId: PRESEASON_ID },
    settings: { sfx: true, bgm: true },
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      breeds: 0,
      hatchlings: 0,
      mutations: 0,
      released: 0,
    },
  };
}
