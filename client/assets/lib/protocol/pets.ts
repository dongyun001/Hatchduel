// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 宠物操作（ONLINE_DESIGN §5.2）。 */
import type { ResourceBag } from '../core';
import type { ProfileWriteResponse } from './profile';

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
