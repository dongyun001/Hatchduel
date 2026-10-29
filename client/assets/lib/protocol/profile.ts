// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 存档拉取与写操作响应（ONLINE_DESIGN §4/§5）。 */
import type { EpochMs, Profile, ProfilePatch } from '../core';

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
