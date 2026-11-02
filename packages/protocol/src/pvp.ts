/**
 * 异步 PvP（ONLINE_DESIGN §6，CONTRACT §7.5 contract-v1.6）。
 *
 * Phase 1 为服务器全自动结算：双方 AI 出令，攻方只看战报。
 * 客户端不提交阵容/属性/seed/结果；防守阵容由 `setPvpDefense` 从本人宠物生成快照。
 */
import type { EpochMs, Id, PetId } from '@petbattle/core';
import type { BattleReplay } from './battle.js';
import type { ProfileWriteResponse } from './profile.js';

/** 设置防守阵容。与 `/lineup/set` 独立，互不联动。 */
export interface SetPvpDefenseRequest {
  petIds: PetId[];
}

/** 防守快照摘要。`units`/属性只在服务端，不随该 DTO 下发。 */
export interface PvpDefenseInfo {
  petIds: PetId[];
  createdAt: EpochMs;
  /** = createdAt + 24h；过期后仍作为对战输入，但 `stale=true`，提示重新设置。 */
  expiresAt: EpochMs;
  stale: boolean;
  contentVersion: string;
}

export interface GetPvpDefenseResponse {
  /** 未设置防守阵容时为 undefined。 */
  defense?: PvpDefenseInfo;
  serverTime: EpochMs;
}

/** 对手概览：只暴露物种/等级/段位，不暴露基因、属性或技能。 */
export interface PvpOpponentSummary {
  accountId: string;
  displayName: string;
  rating: number;
  petCount: number;
  /** 只暴露物种概览，不暴露基因具体值。 */
  speciesPreview: Id[];
  avgLevel: number;
  /** 冷启动机器人：不计榜、不改段位。 */
  isBot: boolean;
}

export interface GetPvpOpponentResponse {
  opponent: PvpOpponentSummary;
  challengesRemaining: number;
  dailyLimit: number;
  seasonId: string;
  serverTime: EpochMs;
}

export interface FightPvpRequest {
  opponentAccountId: string;
}

/** 对手在本场结算后的段位。机器人 `ratingBefore === ratingAfter`。 */
export interface PvpOpponentResult {
  accountId: string;
  displayName: string;
  ratingBefore: number;
  ratingAfter: number;
  isBot: boolean;
}

export interface FightPvpResponse extends ProfileWriteResponse {
  replayId: string;
  /** 攻方视角：0 胜、1 负、null 平。 */
  result: 0 | 1 | null;
  turns: number;
  isBot: boolean;
  seasonId: string;
  ratingBefore: number;
  ratingAfter: number;
  challengesRemaining: number;
  opponent: PvpOpponentResult;
}

export interface PvpReplaySide {
  accountId: string;
  displayName: string;
  ratingBefore: number;
  ratingAfter: number;
}

export interface PvpReplaySummary {
  replayId: string;
  seasonId: string;
  createdAt: EpochMs;
  attacker: PvpReplaySide;
  defender: PvpReplaySide;
  resultForAttacker: 0 | 1 | null;
  isBot: boolean;
}

export interface GetPvpReplayResponse {
  /** version = contentVersion；回放以已存 events 为准，不重新模拟覆盖结果。 */
  replay: BattleReplay;
  summary: PvpReplaySummary;
  serverTime: EpochMs;
}
