// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
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

/**
 * 放入/移出栖息地。`habitatId = null` 表示移出。
 *
 * 放生要求宠物不在栖息地中（DOMAIN §8.6），所以必须有这个入口把宠物移出；
 * 容量、归属、非蛋、槽位去重由服务端与 core 校验。
 */
export interface MovePetToHabitatRequest {
  petId: PetId;
  habitatId: HabitatId | null;
}
