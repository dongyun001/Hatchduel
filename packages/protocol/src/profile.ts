/** 存档拉取与写操作响应（ONLINE_DESIGN §4/§5）。 */
import type { EpochMs, Profile, ProfilePatch } from '@petbattle/core';

export interface GetProfileQuery {
  /** 可选增量：返回该版本之后的 patch；不传则返回全量档。 */
  sinceRevision?: number;
}

export interface GetProfileResponse {
  profile: Profile;
  serverTime: EpochMs;
}

/** 所有写操作的统一返回：增量 patch + 新 revision。 */
export interface ProfileWriteResponse {
  patch: ProfilePatch;
  revision: number;
  serverTime: EpochMs;
}

export interface RenameProfileRequest {
  displayName: string;
}
