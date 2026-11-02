/** 排行榜（ONLINE_DESIGN §7，CONTRACT §7.5 contract-v1.6）。Demo 阶段接口不变，后端先用 DB/内存实现。 */
import type { EpochMs } from '@petbattle/core';

export type LeaderboardKind = 'rating' | 'codex' | 'gene' | 'generation';

export interface LeaderboardQuery {
  kind: LeaderboardKind;
  /** 默认当前赛季；M2 只支持当前赛季，传其他值返回 VALIDATION_FAILED。 */
  seasonId?: string;
  /** 前 N 名（默认 20，最大 50）；M2 不做分页。 */
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
  seasonId: string;
  entries: LeaderboardEntry[];
  /** 本人排名：资格不足时缺省（见 `selfEligible`）。 */
  self?: LeaderboardEntry;
  /** 本人是否具备该榜资格；false 时 `self` 缺省。 */
  selfEligible: boolean;
  serverTime: EpochMs;
}
