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
  EpochMs,
  Id,
  PveRewards,
} from '@petbattle/core';
import type { ProfileWriteResponse } from './profile.js';

export type { BattleEvent, BattleSetup, Command } from '@petbattle/core';

export interface StartPveBattleRequest {
  stageId: Id;
}

export interface StartPveBattleResponse {
  /** 服务端开战 id；奖励领取必须带它做幂等。 */
  battleId: string;
  stageId: Id;
  setup: BattleSetup;
  /** 会话过期时间；过期后 claim 返回 BATTLE_EXPIRED（默认 30 分钟）。 */
  expiresAt: EpochMs;
}

/**
 * PVE 由客户端本地演算也可以，但奖励由服务器复算校验：
 * 客户端提交指令序列，不提交“我赢了”。
 */
export interface ClaimPveBattleRequest {
  battleId: string;
  commands: Command[];
}

/**
 * 奖励结构唯一定义在 `@petbattle/core`（PveRewards）；这里只 re-export，
 * 避免 core 反向依赖 protocol（PITFALLS P-030）。
 */
export type BattleRewards = PveRewards;

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
