/**
 * PvE 会话与结算（ONLINE_DESIGN §6，CONTRACT §7.4 E-01~E-06）。
 *
 * 客户端只提交**完整的指令序列**，不提交胜负：
 * - `start` 用服务器生成的 seed 构建 `BattleSetup` 快照并落会话；
 * - `claim` 用快照从零重放（`core.runBattle`），结算与发奖全部交给 core；
 * - 会话 30 分钟过期，同一账号同时只有一个未结束会话。
 */
import { randomInt, randomUUID } from 'node:crypto';

import { MAX_LINEUP_SIZE } from '@petbattle/core';
import type {
  BattleWinner,
  Command,
  PetInstance,
  Profile,
  PveRewards,
  StageConfig,
} from '@petbattle/core';
import type {
  ClaimPveBattleResponse,
  StartPveBattleResponse,
} from '@petbattle/protocol';

import type { CoreAdapter } from '../domain/core-adapter.js';
import { AppError, revisionConflictError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProfileService } from './profile-service.js';
import type { Store } from '../storage/types.js';

/** 一场 PvE 的指令上限：30 回合 × 双方各 3 只，留一点余量防垃圾请求。 */
const MAX_REPLAY_COMMANDS = 600;

export interface BattleServiceDeps {
  store: Store;
  core: CoreAdapter;
  profiles: ProfileService;
  logger: Logger;
  /** 会话有效期（默认 30 分钟）。 */
  sessionTtlMs: number;
}

export interface StartPveParams {
  accountId: string;
  stageId: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface ClaimPveParams {
  accountId: string;
  battleId: unknown;
  commands: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface StartPveResult {
  data: StartPveBattleResponse;
  revision: number;
}

export interface ClaimPveResult {
  data: ClaimPveBattleResponse;
  revision: number;
}

export class BattleService {
  constructor(private readonly deps: BattleServiceDeps) {}

  async startPve(params: StartPveParams): Promise<StartPveResult> {
    const { accountId, stageId, baseRevision, now } = params;

    const profile = await this.deps.store.getProfile(accountId);
    if (profile === undefined) throw new AppError('NOT_FOUND', '存档不存在');
    if (profile.revision !== baseRevision) throw revisionConflictError(profile, baseRevision);

    const stage = this.findStage(stageId);
    assertStageUnlocked(profile, stage, this.stages());
    const party = partyFromLineup(profile);

    // seed 只能由服务器生成：客户端指定 seed 等于让它挑有利战局。
    const seed = randomInt(1, 0x7fffffff);
    const setup = this.deps.core.buildPveBattleSetup(party, stage, seed);
    const battleId = `battle_${randomUUID()}`;
    const expiresAt = now + this.deps.sessionTtlMs;

    // 同一账号只保留一个未结束会话：旧会话立即失效（E-01）。
    await this.deps.store.invalidateActiveBattleSessions(accountId, now);
    await this.deps.store.createBattleSession({
      battleId,
      accountId,
      stageId: stage.id,
      seed,
      setup,
      partyPetIds: party.map((pet) => pet.id),
      createdAt: now,
      expiresAt,
      status: 'started',
    });

    this.deps.logger.info('PvE 会话开始', {
      accountId,
      battleId,
      stageId: stage.id,
      party: party.map((pet) => pet.id),
    });

    return {
      data: { battleId, stageId: stage.id, setup, expiresAt },
      revision: profile.revision,
    };
  }

  async claimPve(params: ClaimPveParams): Promise<ClaimPveResult> {
    const { accountId, battleId, baseRevision, now } = params;

    const session = await this.deps.store.getBattleSession(requireString(battleId, 'battleId'));
    assertSessionOwned(session, accountId);
    if (session.status === 'claimed') {
      throw new AppError('ALREADY_CLAIMED', '该战斗奖励已领取');
    }
    if (session.expiresAt <= now) {
      throw new AppError('BATTLE_EXPIRED', '战斗会话已过期，请重新开始');
    }

    // 会话有效后才校验指令形状：不存在的 battleId 应先得到 BATTLE_NOT_FOUND。
    const parsedCommands = parseCommands(params.commands);

    let winner: BattleWinner = null;
    let turns = 0;
    let firstClear = false;
    let rewards: PveRewards | undefined;

    const { profile, patch } = await this.deps.profiles.runWrite({
      accountId,
      baseRevision,
      now,
      requestId: params.requestId,
      auditAction: 'battle.pve.claim',
      // 审计详情在 mutate 之后才确定（胜负/回合数）。
      auditDetail: () => ({
        battleId: session.battleId,
        stageId: session.stageId,
        winner,
        turns,
        firstClear,
      }),
      mutate: async (current, nowInner) => {
        // 锁内再读一次：防止并发 claim 或期间被新 start 失效。
        const fresh = await this.deps.store.getBattleSession(session.battleId);
        assertSessionOwned(fresh, accountId);
        if (fresh.status === 'claimed') {
          throw new AppError('ALREADY_CLAIMED', '该战斗奖励已领取');
        }
        if (fresh.expiresAt <= nowInner) {
          throw new AppError('BATTLE_EXPIRED', '战斗会话已过期，请重新开始');
        }

        const stage = this.findStage(fresh.stageId);
        // 重放：指令非法 → BattleReplayError('invalid_command') / 没打完 → not_finished。
        const replay = this.deps.core.runBattle(fresh.setup, parsedCommands);
        winner = replay.winner;
        turns = replay.turns;
        firstClear = winner === 0 && current.stageProgress[stage.id]?.cleared !== true;

        const rewarded = this.deps.core.applyPveRewards(
          current,
          stage,
          { firstClear, winner, partyPetIds: fresh.partyPetIds, turns },
          nowInner,
        );
        rewards = rewarded.rewards;

        const claimed = await this.deps.store.markBattleSessionClaimed(fresh.battleId, nowInner);
        if (!claimed) throw new AppError('ALREADY_CLAIMED', '该战斗奖励已领取');

        return { profile: rewarded.profile, patch: rewarded.patch };
      },
    });

    if (rewards === undefined) {
      throw new AppError('INTERNAL', '战斗结算未返回奖励');
    }

    this.deps.logger.info('PvE 结算完成', {
      accountId,
      battleId: session.battleId,
      stageId: session.stageId,
      winner,
      turns,
      firstClear,
    });

    return {
      data: {
        patch,
        revision: profile.revision,
        serverTime: now,
        winner,
        rewards,
      },
      revision: profile.revision,
    };
  }

  private stages(): readonly StageConfig[] {
    return this.deps.core.allStages();
  }

  private findStage(stageId: unknown): StageConfig {
    const id = requireString(stageId, 'stageId');
    const stage = this.stages().find((entry) => entry.id === id);
    if (stage === undefined) throw new AppError('NOT_FOUND', `关卡不存在：${id}`);
    return stage;
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${label} 必须是非空字符串`);
  }
  return value.trim();
}

function parseCommands(input: unknown): Command[] {
  if (!Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', 'commands 必须是数组');
  }
  if (input.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'commands 不能为空：战斗必须重放到结束');
  }
  if (input.length > MAX_REPLAY_COMMANDS) {
    throw new AppError('VALIDATION_FAILED', `commands 过多（上限 ${MAX_REPLAY_COMMANDS} 条）`);
  }
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new AppError('VALIDATION_FAILED', 'commands 的每一项必须是对象');
    }
  }
  return input as Command[];
}

/** 关卡解锁：order 最小的一关直接开；其余要求前一关已 cleared（E-01）。 */
function assertStageUnlocked(
  profile: Profile,
  stage: StageConfig,
  stages: readonly StageConfig[],
): void {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((entry) => entry.id === stage.id);
  if (index <= 0) return;

  const previous = sorted[index - 1];
  if (previous === undefined) return;
  if (profile.stageProgress[previous.id]?.cleared !== true) {
    throw new AppError('STAGE_LOCKED', `需要先通关 ${previous.id} 才能挑战 ${stage.id}`);
  }
}

/** 出战编队 → 参战个体；校验 1~3 只、存在、非蛋、不重复（CONTRACT §7.4 E-01）。 */
function partyFromLineup(profile: Profile): PetInstance[] {
  const lineup = profile.lineup;
  if (lineup.length === 0) {
    throw new AppError('INVALID_LINEUP', '出战编队为空，请先设置编队');
  }
  if (lineup.length > MAX_LINEUP_SIZE) {
    throw new AppError('INVALID_LINEUP', `出战编队最多 ${MAX_LINEUP_SIZE} 只`);
  }

  const seen = new Set<string>();
  const party: PetInstance[] = [];
  for (const petId of lineup) {
    if (seen.has(petId)) throw new AppError('INVALID_LINEUP', `编队重复：${petId}`);
    seen.add(petId);

    const pet = profile.pets[petId];
    if (pet === undefined) throw new AppError('INVALID_LINEUP', `编队引用了不存在的宠物：${petId}`);
    if (pet.stage === 'egg') throw new AppError('INVALID_LINEUP', `蛋不能参战：${petId}`);
    party.push(pet);
  }
  return party;
}

function assertSessionOwned(
  session: Awaited<ReturnType<Store['getBattleSession']>>,
  accountId: string,
): asserts session is NonNullable<typeof session> {
  if (session === undefined || session.accountId !== accountId) {
    throw new AppError('BATTLE_NOT_FOUND', '战斗会话不存在');
  }
}
