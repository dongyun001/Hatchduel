/** 圈养与栖息地动作（ONLINE_DESIGN §5.2）。 */
import type { HabitatId, Id, PetId, ResourceBag } from '@petbattle/core';
import type { ProfileWriteResponse } from './profile.js';

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
