// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 好友与互访（Phase 2；端点先冻结，实现后置）。 */
import type { EpochMs, HabitatInstance } from '../core';

export interface FriendSummary {
  accountId: string;
  displayName: string;
  lastSeenAt?: EpochMs;
  rating?: number;
}

export interface ListFriendsResponse {
  friends: FriendSummary[];
  serverTime: EpochMs;
}

export interface VisitFriendRequest {
  friendAccountId: string;
}

export interface VisitFriendResponse {
  friend: FriendSummary;
  /** 只读快照；社交动作仍由服务器校验，不能直接加资源。 */
  habitats: HabitatInstance[];
  serverTime: EpochMs;
}
