// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/** 繁殖（ONLINE_DESIGN §5.2，DOMAIN_MODEL §8）。 */
import type { PetId, PetInstance } from '../core';
import type { ProfileWriteResponse } from './profile';

export interface StartBreedingRequest {
  parentA: PetId;
  parentB: PetId;
}

export interface StartBreedingResponse extends ProfileWriteResponse {
  egg: PetInstance;
  /** 3 代内共同祖先；UI 必须红色警告，不能隐藏。 */
  inbred: boolean;
}

export interface ClaimBreedingRequest {
  eggId: PetId;
}

/** 领取孵化结果。结果在建蛋时已确定，客户端只做揭晓动画。 */
export interface ClaimBreedingResponse extends ProfileWriteResponse {
  pet: PetInstance;
}
