/**
 * 异步 PvP（CONTRACT §7.5 F-01~F-07）。
 *
 * 服务器权威：客户端只提交“设置哪些宠物防守 / 打哪个账号”，
 * seed、阵容、属性、胜负、评分全部由服务端生成/计算，并落战报。
 *
 * 并发：
 * - 同一账号的写由 `KeyedMutex` 串行；真人对战按 accountId 升序加锁，避免双打丢更新（P-105）。
 * - 模拟经 `Semaphore(2)` 限并发；超出排队，不拒绝（2C2G，PITFALLS P-022）。
 */
import { randomInt, randomUUID } from 'node:crypto';

import { MVP_SPECIES_IDS } from '@petbattle/core';
import type {
  BattleUnitInit,
  ElementId,
  Id,
  PetId,
  PetInstance,
  Profile,
  PvpState,
} from '@petbattle/core';
import type {
  FightPvpResponse,
  GetPvpDefenseResponse,
  GetPvpOpponentResponse,
  GetPvpReplayResponse,
  ProfileWriteResponse,
  PvpDefenseInfo,
  PvpOpponentSummary,
  PvpReplaySummary,
} from '@petbattle/protocol';

import type { KeyedMutex, Semaphore } from '../concurrency.js';
import type { PvpSettings } from '../config.js';
import type { CoreAdapter } from '../domain/core-adapter.js';
import { partyFromLineup } from '../domain/lineup.js';
import { composePatch } from '../domain/patch.js';
import {
  averageLevel,
  eloDelta,
  invertResult,
  rolloverSeason,
  shanghaiDayKey,
  type PvpResult,
} from '../domain/pvp-rules.js';
import { AppError, revisionConflictError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { ProfileService } from './profile-service.js';
import type { PvpDefenseRecord, PvpReplayRecord, Store } from '../storage/types.js';

const MAX_ID_LENGTH = 128;
const RECENT_OPPONENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_OPPONENT_LIMIT = 3;
const BOT_ID_PATTERN = /^bot_([0-4])$/;
/** 单步模拟超过该值只告警，不改变结果（F-07）。 */
const SLOW_SIMULATION_MS = 10_000;

/** 机器人固定模板的物种 → 元素（与初始档/关卡奖励一致）。 */
const BOT_ELEMENTS: Record<string, ElementId> = {
  turtle: 'water',
  fish: 'thunder',
  frog: 'grass',
  cat: 'fire',
  snake: 'earth',
};

export interface PvpServiceDeps {
  store: Store;
  core: CoreAdapter;
  profiles: ProfileService;
  mutex: KeyedMutex;
  semaphore: Semaphore;
  logger: Logger;
  settings: PvpSettings;
}

export interface SetDefenseParams {
  accountId: string;
  petIds: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface FightPvpParams {
  accountId: string;
  opponentAccountId: unknown;
  baseRevision: number;
  now: number;
  requestId?: string;
}

export interface FightPvpResult {
  data: FightPvpResponse;
  revision: number;
}

interface DefenseCandidate {
  accountId: string;
  displayName: string;
  rating: number;
  avgLevel: number;
  units: BattleUnitInit[];
}

interface RealOpponent {
  isBot: false;
  accountId: string;
  displayName: string;
  snapshot: PvpDefenseRecord;
  profile: Profile;
}

interface BotOpponent {
  isBot: true;
  accountId: string;
  displayName: string;
  snapshot: PvpDefenseRecord;
}

export class PvpService {
  constructor(private readonly deps: PvpServiceDeps) {}

  /** `POST /pvp/defense`：快照与 `profile.pvp.defense` 同事务写入（F-01）。 */
  async setDefense(
    params: SetDefenseParams,
  ): Promise<{ data: ProfileWriteResponse; revision: number }> {
    const { accountId, baseRevision, now, requestId } = params;
    const petIds = parsePetIdList(params.petIds);
    const settings = this.deps.settings;

    let snapshot: PvpDefenseRecord | undefined;

    const result = await this.deps.profiles.runWrite({
      accountId,
      baseRevision,
      now,
      requestId,
      auditAction: 'pvp.defense.set',
      auditDetail: () => ({ petIds, createdAt: snapshot?.createdAt ?? null }),
      commit: (profile, expectedRevision) => {
        if (snapshot === undefined) return Promise.resolve(false);
        return this.deps.store.savePvpDefenseWithProfile(snapshot, profile, expectedRevision);
      },
      mutate: async (current) => {
        const rolled = rolloverSeason(current, settings).profile;
        // 属性/技能/特质在这里定格；之后改配置/升级/放生都不回溯（P-027）。
        const built = this.deps.core.buildDefenseSnapshot(rolled, petIds, now);
        snapshot = {
          accountId,
          petIds: [...built.petIds],
          units: built.units,
          contentVersion: built.contentVersion,
          createdAt: built.createdAt,
          expiresAt: now + settings.snapshotTtlMs,
        };

        const pvp: PvpState = { ...rolled.pvp, defense: [...petIds] };
        return { profile: { ...rolled, pvp }, patch: { pvp } };
      },
    });

    return {
      data: {
        patch: result.patch,
        revision: result.profile.revision,
        serverTime: now,
      },
      revision: result.profile.revision,
    };
  }

  /** `GET /pvp/defense`：未设置返回缺省；过期仍返回，但 `stale=true`。 */
  async getDefense(accountId: string, now: number): Promise<GetPvpDefenseResponse> {
    const snapshot = await this.deps.store.getPvpDefense(accountId);
    if (snapshot === undefined) return { serverTime: now };

    const info: PvpDefenseInfo = {
      petIds: [...snapshot.petIds],
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      stale: now > snapshot.expiresAt,
      contentVersion: snapshot.contentVersion,
    };
    return { defense: info, serverTime: now };
  }

  /** `GET /pvp/opponent`：服务端选对手；匹配不消耗次数。 */
  async getOpponent(accountId: string, now: number): Promise<GetPvpOpponentResponse> {
    const profile = await this.deps.store.getProfile(accountId);
    if (profile === undefined) throw new AppError('NOT_FOUND', '存档不存在');

    const settings = this.deps.settings;
    const rolled = rolloverSeason(profile, settings).profile;
    const dayKey = shanghaiDayKey(now);
    const used = await this.deps.store.getDailyUsed(accountId, dayKey);
    const challengesRemaining = Math.max(0, settings.dailyChallenges - used);

    const candidate = await this.selectOpponent(accountId, rolled, now);
    if (candidate !== undefined) {
      return {
        opponent: {
          accountId: candidate.accountId,
          displayName: candidate.displayName,
          rating: candidate.rating,
          petCount: candidate.units.length,
          speciesPreview: candidate.units.map((unit) => unit.speciesId),
          avgLevel: Math.round(candidate.avgLevel * 100) / 100,
          isBot: false,
        },
        challengesRemaining,
        dailyLimit: settings.dailyChallenges,
        seasonId: settings.seasonId,
        serverTime: now,
      };
    }

    if (!settings.botsEnabled) {
      throw new AppError('OPPONENT_UNAVAILABLE', '当前没有可挑战的对手');
    }

    return {
      opponent: this.botSummary(accountId, attackerAverageLevel(rolled)),
      challengesRemaining,
      dailyLimit: settings.dailyChallenges,
      seasonId: settings.seasonId,
      serverTime: now,
    };
  }

  /** `POST /pvp/fight`：全自动模拟 + 双方结算 + 战报落库（F-03）。 */
  async fight(params: FightPvpParams): Promise<FightPvpResult> {
    const opponentId = requireIdString(params.opponentAccountId, 'opponentAccountId');
    if (opponentId === params.accountId) {
      throw new AppError('OPPONENT_UNAVAILABLE', '不能挑战自己');
    }

    const botOffset = parseBotId(opponentId);
    if (botOffset !== undefined) {
      if (!this.deps.settings.botsEnabled) {
        throw new AppError('OPPONENT_UNAVAILABLE', '机器人对手已禁用');
      }
      return this.withAccountLocks([params.accountId], () =>
        this.runFight(params, opponentId, botOffset),
      );
    }

    return this.withAccountLocks([params.accountId, opponentId], () =>
      this.runFight(params, opponentId, undefined),
    );
  }

  /** `GET /pvp/replay/:id`：仅攻守双方可读；30 天后 REPLAY_EXPIRED（F-06）。 */
  async getReplay(
    accountId: string,
    replayId: unknown,
    now: number,
  ): Promise<GetPvpReplayResponse> {
    const id = requireIdString(replayId, 'replayId');
    const replay = await this.deps.store.getPvpReplay(id);
    if (replay === undefined) throw new AppError('NOT_FOUND', '战报不存在');

    const isParticipant =
      replay.attackerId === accountId || (!replay.isBot && replay.defenderId === accountId);
    if (!isParticipant) throw new AppError('FORBIDDEN', '只有攻守双方可以查看该战报');

    if (now > replay.expiresAt) throw new AppError('REPLAY_EXPIRED', '战报已超过保留期');

    const accounts = new Map(
      (await this.deps.store.listAccounts()).map((account) => [account.id, account]),
    );

    const summary: PvpReplaySummary = {
      replayId: replay.replayId,
      seasonId: replay.seasonId,
      createdAt: replay.createdAt,
      attacker: {
        accountId: replay.attackerId,
        displayName: accounts.get(replay.attackerId)?.displayName ?? replay.attackerId,
        ratingBefore: replay.attackerRatingBefore,
        ratingAfter: replay.attackerRatingAfter,
      },
      defender: {
        accountId: replay.defenderId,
        displayName: this.opponentDisplayName(replay, accounts),
        ratingBefore: replay.defenderRatingBefore,
        ratingAfter: replay.defenderRatingAfter,
      },
      resultForAttacker: replay.winner,
      isBot: replay.isBot,
    };

    return {
      replay: {
        version: replay.contentVersion,
        setup: replay.setup,
        seed: replay.seed,
        commands: replay.commands,
        events: replay.events,
        winner: replay.winner,
        turns: replay.turns,
      },
      summary,
      serverTime: now,
    };
  }

  // ---------------------------------------------------------------------------

  private async runFight(
    params: FightPvpParams,
    opponentId: string,
    botOffset: number | undefined,
  ): Promise<FightPvpResult> {
    const { accountId, baseRevision, now, requestId } = params;
    const settings = this.deps.settings;

    const attackerCurrent = await this.deps.store.getProfile(accountId);
    if (attackerCurrent === undefined) throw new AppError('NOT_FOUND', '存档不存在');
    if (attackerCurrent.revision !== baseRevision) {
      throw revisionConflictError(attackerCurrent, baseRevision);
    }

    const advanced = this.deps.core.advanceProfile(attackerCurrent, now);
    const attacker = rolloverSeason(advanced.profile, settings).profile;
    const party = partyFromLineup(attacker);

    const opponent =
      botOffset === undefined
        ? await this.loadRealOpponent(opponentId, now)
        : this.buildBotOpponent(opponentId, botOffset, attackerAverageLevel(attacker), now);

    // 顺序按 F-03：编队 → 对手 → 当日次数。
    const dayKey = shanghaiDayKey(now);
    const used = await this.deps.store.getDailyUsed(accountId, dayKey);
    if (used >= settings.dailyChallenges) {
      throw new AppError('DAILY_LIMIT_REACHED', '今日 PvP 挑战次数已用完');
    }

    const seed = randomInt(1, 0x7fffffff);
    const setup = this.deps.core.buildPvpBattleSetup(party, opponent.snapshot.units, seed);

    const startedAt = performance.now();
    const simulation = await this.deps.semaphore.run(async () => this.deps.core.simulatePvp(setup));
    const elapsedMs = performance.now() - startedAt;
    if (elapsedMs > SLOW_SIMULATION_MS) {
      this.deps.logger.warn('pvp.slow', {
        accountId,
        opponentId,
        elapsedMs: Math.round(elapsedMs),
      });
    }

    const result = resultOf(simulation.winner);
    const attackerBefore = attacker.pvp.rating;
    const defenderBefore = opponent.isBot ? settings.botRating : opponent.profile.pvp.rating;

    let attackerAfter = attackerBefore;
    let defenderAfter = defenderBefore;
    if (!opponent.isBot) {
      const delta = eloDelta(attackerBefore, defenderBefore, result, settings);
      attackerAfter = Math.max(0, attackerBefore + delta);
      defenderAfter = Math.max(0, defenderBefore - delta);
    }

    const attackerOutcome = this.deps.core.applyPvpOutcome(attacker, {
      result,
      ranked: !opponent.isBot,
      ratingAfter: attackerAfter,
      seasonId: settings.seasonId,
    });

    const nextAttacker: Profile = {
      ...attackerOutcome.profile,
      revision: attackerCurrent.revision + 1,
    };
    const saved = await this.deps.store.saveProfile(nextAttacker, attackerCurrent.revision);
    if (!saved) {
      const latest = await this.deps.store.getProfile(accountId);
      if (latest === undefined) throw new AppError('NOT_FOUND', '存档不存在');
      throw revisionConflictError(latest, baseRevision);
    }

    if (!opponent.isBot) {
      await this.saveDefenderOutcome(
        opponent.accountId,
        result,
        defenderAfter,
        settings.seasonId,
        now,
      );
    }

    const replayId = `replay_${randomUUID()}`;
    const replay: PvpReplayRecord = {
      replayId,
      attackerId: accountId,
      defenderId: opponentId,
      isBot: opponent.isBot,
      seasonId: settings.seasonId,
      contentVersion: this.deps.core.contentVersion(),
      setup,
      seed,
      commands: simulation.commands,
      events: simulation.events,
      winner: simulation.winner,
      turns: simulation.turns,
      attackerRatingBefore: attackerBefore,
      attackerRatingAfter: attackerAfter,
      defenderRatingBefore: defenderBefore,
      defenderRatingAfter: defenderAfter,
      createdAt: now,
      expiresAt: now + settings.replayTtlMs,
    };
    await this.deps.store.createPvpReplay(replay);

    const usedAfter = await this.deps.store.incrementDailyUsed(accountId, dayKey);

    await this.audit(
      accountId,
      {
        replayId,
        attacker: accountId,
        defender: opponentId,
        result,
        isBot: opponent.isBot,
        seasonId: settings.seasonId,
        attackerRatingBefore: attackerBefore,
        attackerRatingAfter: attackerAfter,
        defenderRatingBefore: defenderBefore,
        defenderRatingAfter: defenderAfter,
        turns: simulation.turns,
      },
      now,
      requestId,
    );

    const patch = composePatch(advanced.patch, attackerOutcome.patch, {
      from: baseRevision,
      to: nextAttacker.revision,
      at: now,
      lastEvaluatedAt: nextAttacker.lastEvaluatedAt,
    });

    this.deps.logger.info('PvP 结算完成', {
      accountId,
      opponentId,
      replayId,
      isBot: opponent.isBot,
      result,
      turns: simulation.turns,
      attackerRatingBefore: attackerBefore,
      attackerRatingAfter: attackerAfter,
    });

    return {
      data: {
        patch,
        revision: nextAttacker.revision,
        serverTime: now,
        replayId,
        result: simulation.winner,
        turns: simulation.turns,
        isBot: opponent.isBot,
        seasonId: settings.seasonId,
        ratingBefore: attackerBefore,
        ratingAfter: attackerAfter,
        challengesRemaining: Math.max(0, settings.dailyChallenges - usedAfter),
        opponent: {
          accountId: opponentId,
          displayName: opponent.displayName,
          ratingBefore: defenderBefore,
          ratingAfter: defenderAfter,
          isBot: opponent.isBot,
        },
      },
      revision: nextAttacker.revision,
    };
  }

  /** 防守方结算：CAS 失败时重读最新档后重试，不丢其他写操作的 stats 更新（P-105）。 */
  private async saveDefenderOutcome(
    accountId: string,
    attackerResult: PvpResult,
    ratingAfter: number,
    seasonId: string,
    now: number,
  ): Promise<void> {
    const result = invertResult(attackerResult);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.deps.store.getProfile(accountId);
      if (current === undefined) {
        throw new AppError('OPPONENT_UNAVAILABLE', '对手存档不存在');
      }
      const advanced = this.deps.core.advanceProfile(current, now).profile;
      const rolled = rolloverSeason(advanced, this.deps.settings).profile;
      const outcome = this.deps.core.applyPvpOutcome(rolled, {
        result,
        ranked: true,
        ratingAfter,
        seasonId,
      });
      const next: Profile = { ...outcome.profile, revision: current.revision + 1 };
      if (await this.deps.store.saveProfile(next, current.revision)) return;
    }

    throw new AppError('INTERNAL', '防守方评分更新失败（revision 连续冲突）');
  }

  private async loadRealOpponent(opponentId: string, now: number): Promise<RealOpponent> {
    const account = await this.deps.store.getAccount(opponentId);
    if (account === undefined || account.status !== 'active') {
      throw new AppError('OPPONENT_UNAVAILABLE', '对手不存在或不可挑战');
    }
    const profile = await this.deps.store.getProfile(opponentId);
    if (profile === undefined) throw new AppError('OPPONENT_UNAVAILABLE', '对手存档不存在');

    const snapshot = await this.deps.store.getPvpDefense(opponentId);
    if (snapshot === undefined || snapshot.units.length === 0) {
      throw new AppError('OPPONENT_UNAVAILABLE', '对手没有有效的防守阵容');
    }

    const advanced = this.deps.core.advanceProfile(profile, now).profile;
    const rolled = rolloverSeason(advanced, this.deps.settings).profile;

    return {
      isBot: false,
      accountId: opponentId,
      displayName: account.displayName,
      snapshot,
      profile: rolled,
    };
  }

  private buildBotOpponent(
    opponentId: string,
    offset: number,
    attackerAvgLevel: number,
    now: number,
  ): BotOpponent {
    const speciesIds = botSpeciesIds(offset);
    const level = clampLevel(Math.round(attackerAvgLevel));
    const breeding = this.deps.core.breedingConfig();
    const bornAt = now - breeding.hatchMs - breeding.juvenileMs;

    const pets: Record<PetId, PetInstance> = {};
    const petIds: PetId[] = [];

    speciesIds.forEach((speciesId, index) => {
      const petId = `${opponentId}_${index}`;
      const created = this.deps.core.createPet({
        id: petId,
        speciesId,
        elementId: botElement(speciesId),
        genome: {
          stats: { hp: 50, atk: 50, def: 50, spd: 50 },
          speciesAlleles: [speciesId, speciesId],
          elementAlleles: [botElement(speciesId), botElement(speciesId)],
          traitAlleles: [],
          mutationCount: 0,
        },
        gender: index % 2 === 0 ? 'male' : 'female',
        generation: 1,
        parents: [null, null],
        level,
        now: bornAt,
      });
      const adult = this.deps.core.advancePet(created, now).pet;
      pets[petId] = adult;
      petIds.push(petId);
    });

    const container = botProfileContainer(opponentId, now, pets, this.deps.settings);
    const built = this.deps.core.buildDefenseSnapshot(container, petIds, now);

    return {
      isBot: true,
      accountId: opponentId,
      displayName: this.botDisplayName(speciesIds[0]!),
      snapshot: {
        accountId: opponentId,
        petIds: [...built.petIds],
        units: built.units,
        contentVersion: built.contentVersion,
        createdAt: built.createdAt,
        expiresAt: built.expiresAt,
      },
    };
  }

  /** 候选 + 窗口 + 最近对手排除 + 排序（F-02）。 */
  private async selectOpponent(
    accountId: string,
    attacker: Profile,
    now: number,
  ): Promise<DefenseCandidate | undefined> {
    const settings = this.deps.settings;
    const [defenses, accounts, profiles] = await Promise.all([
      this.deps.store.listPvpDefenses(),
      this.deps.store.listAccounts(),
      this.deps.store.listProfiles(),
    ]);

    const accountMap = new Map(accounts.map((account) => [account.id, account] as const));
    const profileMap = new Map(profiles.map((profile) => [profile.accountId, profile] as const));

    const candidates: DefenseCandidate[] = [];
    for (const defense of defenses) {
      if (defense.accountId === accountId) continue;
      if (defense.units.length === 0) continue;
      const account = accountMap.get(defense.accountId);
      if (account === undefined || account.status !== 'active') continue;
      const profile = profileMap.get(defense.accountId);
      if (profile === undefined) continue;

      const rolled = rolloverSeason(profile, settings).profile;
      candidates.push({
        accountId: defense.accountId,
        displayName: account.displayName,
        rating: rolled.pvp.rating,
        avgLevel: averageLevel(defense.units.map((unit) => unit.level)),
        units: defense.units,
      });
    }

    if (candidates.length === 0) return undefined;

    const recent = await this.recentOpponents(accountId, now);
    const attackerAvgLevel = attackerAverageLevel(attacker);

    for (const window of settings.matchWindows) {
      let pool = candidates.filter(
        (candidate) => Math.abs(candidate.rating - attacker.pvp.rating) <= window,
      );
      if (pool.length === 0) continue;

      if (pool.length >= RECENT_OPPONENT_LIMIT) {
        const filtered = pool.filter((candidate) => !recent.has(candidate.accountId));
        if (filtered.length > 0) pool = filtered;
      }

      pool.sort((a, b) => {
        const ratingDiff =
          Math.abs(a.rating - attacker.pvp.rating) - Math.abs(b.rating - attacker.pvp.rating);
        if (ratingDiff !== 0) return ratingDiff;
        const levelDiff =
          Math.abs(a.avgLevel - attackerAvgLevel) - Math.abs(b.avgLevel - attackerAvgLevel);
        if (levelDiff !== 0) return levelDiff;
        return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
      });

      return pool[0];
    }

    return undefined;
  }

  private async recentOpponents(accountId: string, now: number): Promise<Set<string>> {
    const replays = await this.deps.store.listPvpReplaysByAttacker(
      accountId,
      now - RECENT_OPPONENT_WINDOW_MS,
    );
    const recent: string[] = [];
    for (const replay of replays) {
      if (replay.isBot) continue;
      if (recent.includes(replay.defenderId)) continue;
      recent.push(replay.defenderId);
      if (recent.length >= RECENT_OPPONENT_LIMIT) break;
    }
    return new Set(recent);
  }

  private botSummary(attackerAccountId: string, attackerAvgLevel: number): PvpOpponentSummary {
    const offset = botOffsetFor(attackerAccountId);
    const speciesIds = botSpeciesIds(offset);
    return {
      accountId: `bot_${offset}`,
      displayName: this.botDisplayName(speciesIds[0]!),
      rating: this.deps.settings.botRating,
      petCount: speciesIds.length,
      speciesPreview: speciesIds,
      avgLevel: clampLevel(Math.round(attackerAvgLevel)),
      isBot: true,
    };
  }

  private botDisplayName(speciesId: Id): string {
    const name = this.deps.core.speciesName(speciesId);
    return `训练师·${name}`;
  }

  private opponentDisplayName(
    replay: PvpReplayRecord,
    accounts: Map<string, { displayName: string }>,
  ): string {
    if (!replay.isBot) {
      return accounts.get(replay.defenderId)?.displayName ?? replay.defenderId;
    }
    const offset = parseBotId(replay.defenderId);
    if (offset === undefined) return replay.defenderId;
    return this.botDisplayName(botSpeciesIds(offset)[0]!);
  }

  private async audit(
    accountId: string,
    detail: Record<string, unknown>,
    now: number,
    requestId?: string,
  ): Promise<void> {
    try {
      await this.deps.store.appendAudit({
        at: now,
        accountId,
        action: 'pvp.fight',
        detail,
        requestId,
      });
    } catch (error) {
      this.deps.logger.error('审计写入失败', {
        accountId,
        action: 'pvp.fight',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 按 accountId 升序嵌套加锁；同一账号的写不会交叉，也不会互相死锁。 */
  private async withAccountLocks<T>(ids: readonly string[], task: () => Promise<T>): Promise<T> {
    const keys = [...new Set(ids)].sort();
    const run = (index: number): Promise<T> => {
      if (index >= keys.length) return task();
      return this.deps.mutex.run(keys[index]!, () => run(index + 1));
    };
    return run(0);
  }
}

// -----------------------------------------------------------------------------
// 纯辅助

function parsePetIdList(input: unknown): PetId[] {
  if (!Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', 'petIds 必须是数组');
  }
  const ids: PetId[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'petIds 只能包含非空字符串');
    }
    ids.push(raw.trim());
  }
  return ids;
}

function requireIdString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${label} 必须是非空字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_ID_LENGTH) {
    throw new AppError('VALIDATION_FAILED', `${label} 过长（上限 ${MAX_ID_LENGTH}）`);
  }
  return trimmed;
}

function resultOf(winner: 0 | 1 | null): PvpResult {
  if (winner === 0) return 'win';
  if (winner === 1) return 'loss';
  return 'draw';
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(20, Math.max(1, Math.trunc(level)));
}

function attackerAverageLevel(profile: Profile): number {
  const levels: number[] = [];
  for (const petId of profile.lineup) {
    const pet = profile.pets[petId];
    if (pet === undefined || pet.stage === 'egg') continue;
    levels.push(pet.level);
  }
  return averageLevel(levels);
}

function botOffsetFor(accountId: string): number {
  // FNV-1a：同一账号稳定映射到 5 个物种模板之一，不引入随机。
  let hash = 0x811c9dc5;
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % MVP_SPECIES_IDS.length;
}

function parseBotId(accountId: string): number | undefined {
  const match = BOT_ID_PATTERN.exec(accountId);
  return match === null ? undefined : Number(match[1]);
}

function botSpeciesIds(offset: number): Id[] {
  return [0, 1, 2].map((step) => MVP_SPECIES_IDS[(offset + step) % MVP_SPECIES_IDS.length] as Id);
}

function botElement(speciesId: Id): ElementId {
  return BOT_ELEMENTS[speciesId] ?? 'water';
}

/** 机器人快照只借 `buildDefenseSnapshot` 的定型逻辑，容器不落库。 */
function botProfileContainer(
  accountId: string,
  now: number,
  pets: Record<PetId, PetInstance>,
  settings: PvpSettings,
): Profile {
  return {
    version: 1,
    accountId,
    revision: 0,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: { coin: 0, food: 0, geneDust: 0, premium: 0 },
    pets,
    habitats: {},
    codex: {},
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: settings.botRating, seasonId: settings.seasonId },
    settings: { sfx: true, bgm: true },
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      breeds: 0,
      hatchlings: 0,
      mutations: 0,
      released: 0,
    },
  };
}
