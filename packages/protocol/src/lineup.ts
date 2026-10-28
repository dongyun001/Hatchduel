/** 出战编队（PRD §12，ONLINE_DESIGN §5.2）。 */
import type { PetId } from '@petbattle/core';
import type { ProfileWriteResponse } from './profile.js';

/**
 * 设置出战编队。与 `/pvp/defense` 是两个独立系统，互不联动。
 *
 * 服务端校验：最多 3 只、属于本人、非蛋、引用存在；幼年可上阵（属性 70%）。
 */
export interface SetLineupRequest {
  petIds: PetId[];
}

export type SetLineupResponse = ProfileWriteResponse;
