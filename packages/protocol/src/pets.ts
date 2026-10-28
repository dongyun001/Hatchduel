/** 宠物操作（ONLINE_DESIGN §5.2）。 */
import type { ResourceBag } from '@petbattle/core';
import type { ProfileWriteResponse } from './profile.js';

export interface RenamePetRequest {
  name: string;
}

export interface SetPetLockRequest {
  locked: boolean;
}

export interface ReleasePetResponse extends ProfileWriteResponse {
  /** 放生返还的基因尘。 */
  refund: ResourceBag;
}
