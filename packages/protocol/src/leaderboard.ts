/** 排行榜（ONLINE_DESIGN §7）。Demo 阶段接口不变，后端先用 DB/内存实现。 */
import type { EpochMs } from '@petbattle/core';

export type LeaderboardKind = 'rating' | 'codex' | 'gene' | 'generation';

export interface LeaderboardQuery {
  kind: LeaderboardKind;
  seasonId?: string;
  /** 只允许前 N 名 + 自己，防止全量拉取。 */
  limit?: number;
}

export interface LeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string;
  value: number;
}

export interface LeaderboardResponse {
  kind: LeaderboardKind;
  seasonId?: string;
  entries: LeaderboardEntry[];
  self?: LeaderboardEntry;
  serverTime: EpochMs;
}
