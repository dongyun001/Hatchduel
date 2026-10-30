// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/** 出战编队（PRD §12，ONLINE_DESIGN §5.2）。 */
import type { PetId } from '../core';
import type { ProfileWriteResponse } from './profile';

/**
 * 设置出战编队。与 `/pvp/defense` 是两个独立系统，互不联动。
 *
 * 服务端校验：最多 3 只、属于本人、非蛋、引用存在；幼年可上阵（属性 70%）。
 */
export interface SetLineupRequest {
  petIds: PetId[];
}

export type SetLineupResponse = ProfileWriteResponse;
