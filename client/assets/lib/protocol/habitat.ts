// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 圈养与栖息地动作（ONLINE_DESIGN §5.2）。 */
import type { HabitatId, Id, PetId, ResourceBag } from '../core';
import type { ProfileWriteResponse } from './profile';

export interface CollectHabitatRequest {
  habitatId: HabitatId;
}

export interface CollectHabitatResponse extends ProfileWriteResponse {
  /** 本次领取进 currencies 的资源。 */
  collected: ResourceBag;
}

export interface FeedPetRequest {
  petId: PetId;
  foodId: Id;
}

export interface CleanPetRequest {
  petId: PetId;
}

export interface PlayWithPetRequest {
  petId: PetId;
}

export interface UpgradeHabitatRequest {
  habitatId: HabitatId;
}
