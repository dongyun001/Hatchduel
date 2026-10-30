// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 战斗 DTO（TECH_DESIGN §12）。
 *
 * `BattleSetup` / `Command` / `BattleEvent` 的唯一定义在 `@petbattle/core`，
 * 这里只做 re-export，禁止复制（PITFALLS P-030）。
 */
import type {
  BattleEvent,
  BattleSetup,
  Command,
  Id,
  PetInstance,
  ResourceBag,
} from '../core';
import type { ProfileWriteResponse } from './profile';

export type { BattleEvent, BattleSetup, Command } from '../core';

export interface StartPveBattleRequest {
  stageId: Id;
}

export interface StartPveBattleResponse {
  /** 服务端开战 id；奖励领取必须带它做幂等。 */
  battleId: string;
  stageId: Id;
  setup: BattleSetup;
}

/**
 * PVE 由客户端本地演算也可以，但奖励由服务器复算校验：
 * 客户端提交指令序列，不提交“我赢了”。
 */
export interface ClaimPveBattleRequest {
  battleId: string;
  commands: Command[];
}

export interface BattleRewards {
  resources?: ResourceBag;
  petExp?: number;
  pets?: PetInstance[];
  firstClear: boolean;
}

export interface ClaimPveBattleResponse extends ProfileWriteResponse {
  winner: 0 | 1 | null;
  rewards: BattleRewards;
}

/** 回放 = setup + seed + commands；事件流用于演出和调试。 */
export interface BattleReplay {
  /** 产生该战报的 core / 配置版本，避免升级后回放错位。 */
  version: string;
  setup: BattleSetup;
  seed: number;
  commands: Command[];
  events?: BattleEvent[];
  winner: 0 | 1 | null;
  turns: number;
}
