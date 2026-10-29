// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/** 异步 PvP（ONLINE_DESIGN §6）。Phase 1 为服务器全自动结算，攻方只看战报。 */
import type { EpochMs, Id, PetId } from '../core';
import type { BattleReplay } from './battle';
import type { ProfileWriteResponse } from './profile';

/** 设置防守阵容。与 `/lineup/set` 独立，互不联动。 */
export interface SetPvpDefenseRequest {
  petIds: PetId[];
}

export interface PvpOpponentSummary {
  accountId: string;
  displayName: string;
  rating: number;
  petCount: number;
  /** 只暴露物种概览，不暴露基因具体值。 */
  speciesPreview: Id[];
}

export interface GetPvpOpponentResponse {
  opponent: PvpOpponentSummary;
  serverTime: EpochMs;
}

export interface FightPvpRequest {
  opponentAccountId: string;
}

export interface FightPvpResponse extends ProfileWriteResponse {
  replayId: string;
  /** 攻方视角：0 胜、1 负、null 平。 */
  result: 0 | 1 | null;
  ratingBefore: number;
  ratingAfter: number;
}

export interface GetPvpReplayResponse {
  replay: BattleReplay;
  serverTime: EpochMs;
}
