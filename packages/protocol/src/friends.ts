/** 好友与互访（Phase 2；端点先冻结，实现后置）。 */
import type { EpochMs, HabitatInstance } from '@petbattle/core';

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
