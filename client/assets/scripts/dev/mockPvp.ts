import {
  BattleEngine,
  advancePet,
  applyProfilePatch,
  buildBattleSetup,
  createPet,
} from '../../lib/core';
import type {
  BattleEvent,
  Command,
  ConfigRepo,
  ElementId,
  EpochMs,
  Genome,
  PetInstance,
  Profile,
  ProfilePatch,
  ProfileStats,
} from '../../lib/core';
import type {
  BattleReplay,
  FightPvpResponse,
  GetPvpDefenseResponse,
  GetPvpOpponentResponse,
  GetPvpReplayResponse,
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardResponse,
  PvpDefenseInfo,
  PvpOpponentSummary,
  PvpReplaySummary,
} from '../../lib/protocol';

/**
 * 离线 PvP（M2 mock 路径，contract-v1.6 §7.5）。
 *
 * 目标：在 C 的 `/pvp/*` 上线前把 UI 交互跑通。
 * - 对手/评分/日报/战报都在本地生成，结构按 §7.5 DTO；
 * - 战斗用 core 的 `buildBattleSetup` + `BattleEngine.autoCommand` 真实模拟，
 *   战报保存 `events`，回放页只播事件，不在客户端重算；
 * - Elo 只在这里的 mock 结算中使用（契约要求 Elo 不进 core）。
 *
 * 该模块不依赖 Cocos，可在 Node 校验脚本里用内存 storage 跑。
 */
export const MOCK_PVP_LIMIT = {
  dailyChallenges: 10,
  initialRating: 1000,
  kWin: 32,
  kLoss: 24,
  kDraw: 16,
  snapshotTtlMs: 24 * 60 * 60 * 1000,
  replayTtlMs: 30 * 24 * 60 * 60 * 1000,
  historyLimit: 5,
} as const;

export const MOCK_PVP_KEYS = {
  defense: 'petbattle.pvp.defense.v1',
  daily: 'petbattle.pvp.daily.v1',
  replay: 'petbattle.pvp.replay.v1',
  ranked: 'petbattle.pvp.ranked.v1',
} as const;

export interface MockPvpStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export type MockPvpErrorCode =
  | 'INVALID_LINEUP'
  | 'DAILY_LIMIT_REACHED'
  | 'OPPONENT_UNAVAILABLE'
  | 'REPLAY_EXPIRED'
  | 'NOT_FOUND';

export class MockPvpError extends Error {
  readonly code: MockPvpErrorCode;

  constructor(code: MockPvpErrorCode, message: string) {
    super(message);
    this.name = 'MockPvpError';
    this.code = code;
  }
}

interface StoredDefense {
  petIds: string[];
  createdAt: EpochMs;
  expiresAt: EpochMs;
  contentVersion: string;
}

interface StoredDaily {
  day: string;
  used: number;
}

/** 当前赛季的真人排位场次（机器人不计）；rating 榜资格用，跨日不清零。 */
interface StoredRanked {
  seasonId: string;
  played: number;
}

interface StoredReplay {
  replay: BattleReplay;
  summary: PvpReplaySummary;
}

type ReplayBag = Record<string, StoredReplay>;

function hash(text: string): number {
  let value = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Asia/Shanghai 的日期键（mock 与服务器切日口径一致）。 */
function dayKey(now: EpochMs): string {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function nonEggPets(profile: Profile): PetInstance[] {
  return Object.values(profile.pets).filter((pet) => pet.stage !== 'egg');
}

function attackerPets(profile: Profile): PetInstance[] {
  const lineup = profile.lineup
    .map((id) => profile.pets[id])
    .filter((pet): pet is PetInstance => Boolean(pet));
  if (lineup.length === 0 || lineup.length > 3) {
    throw new MockPvpError('INVALID_LINEUP', '出战编队需要 1~3 只宠物');
  }
  if (lineup.some((pet) => pet.stage === 'egg')) {
    throw new MockPvpError('INVALID_LINEUP', '蛋不能出战');
  }
  return lineup;
}

async function readDaily(storage: MockPvpStorage, now: EpochMs): Promise<StoredDaily> {
  const day = dayKey(now);
  const stored = await storage.get<StoredDaily>(MOCK_PVP_KEYS.daily);
  if (!stored || stored.day !== day) return { day, used: 0 };
  return { day, used: Math.max(0, Math.floor(stored.used)) };
}

async function readRanked(storage: MockPvpStorage, seasonId: string): Promise<StoredRanked> {
  const stored = await storage.get<StoredRanked>(MOCK_PVP_KEYS.ranked);
  if (!stored || stored.seasonId !== seasonId) return { seasonId, played: 0 };
  return { seasonId, played: Math.max(0, Math.floor(stored.played)) };
}

function remainingOf(daily: StoredDaily): number {
  return Math.max(0, MOCK_PVP_LIMIT.dailyChallenges - daily.used);
}

function toInfo(record: StoredDefense, now: EpochMs): PvpDefenseInfo {
  return {
    petIds: [...record.petIds],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    stale: now >= record.expiresAt,
    contentVersion: record.contentVersion,
  };
}

export async function mockGetDefense(
  profile: Profile,
  storage: MockPvpStorage,
  now: EpochMs,
  cfg: ConfigRepo,
): Promise<GetPvpDefenseResponse> {
  const stored = await storage.get<StoredDefense>(MOCK_PVP_KEYS.defense);
  if (stored && stored.petIds.length > 0) return { defense: toInfo(stored, now), serverTime: now };

  if (profile.pvp.defense.length > 0) {
    // 服务端快照缺失（例如刚切到 mock）时，用 profile.pvp.defense 还原可见状态。
    const record: StoredDefense = {
      petIds: [...profile.pvp.defense],
      createdAt: profile.lastEvaluatedAt,
      expiresAt: profile.lastEvaluatedAt + MOCK_PVP_LIMIT.snapshotTtlMs,
      contentVersion: cfg.contentVersion,
    };
    await storage.set(MOCK_PVP_KEYS.defense, record);
    return { defense: toInfo(record, now), serverTime: now };
  }
  return { serverTime: now };
}

export interface MockSetDefenseResult {
  profile: Profile;
  patch: ProfilePatch;
  info: PvpDefenseInfo;
}

export async function mockSetDefense(
  profile: Profile,
  petIds: readonly string[],
  storage: MockPvpStorage,
  now: EpochMs,
  cfg: ConfigRepo,
): Promise<MockSetDefenseResult> {
  const ids = [...petIds];
  if (ids.length < 1 || ids.length > 3) {
    throw new MockPvpError('INVALID_LINEUP', '防守阵容需要 1~3 只宠物');
  }
  if (new Set(ids).size !== ids.length) {
    throw new MockPvpError('INVALID_LINEUP', '防守阵容不能重复');
  }
  for (const id of ids) {
    const pet = profile.pets[id];
    if (!pet) throw new MockPvpError('INVALID_LINEUP', '防守阵容里有不存在的宠物');
    if (pet.stage === 'egg') throw new MockPvpError('INVALID_LINEUP', '蛋不能进入防守阵容');
  }

  const record: StoredDefense = {
    petIds: ids,
    createdAt: now,
    expiresAt: now + MOCK_PVP_LIMIT.snapshotTtlMs,
    contentVersion: cfg.contentVersion,
  };
  await storage.set(MOCK_PVP_KEYS.defense, record);

  const nextPvp = { ...profile.pvp, defense: [...ids] };
  const patch: ProfilePatch = {
    fromRevision: profile.revision,
    toRevision: profile.revision + 1,
    at: now,
    lastEvaluatedAt: profile.lastEvaluatedAt,
    pvp: nextPvp,
  };
  const next = applyProfilePatch(profile, patch);
  return { profile: next, patch, info: toInfo(record, now) };
}

function averageLevel(pets: readonly PetInstance[]): number {
  if (pets.length === 0) return 1;
  return pets.reduce((sum, pet) => sum + pet.level, 0) / pets.length;
}

const OPPONENT_NAMES = ['阿岩', '青禾', '小火苗', '浪花', '苔苔', '铁壳', '雷影', '沙棘', '星尾', '木木'];

export async function mockGetOpponent(
  profile: Profile,
  storage: MockPvpStorage,
  now: EpochMs,
  cfg: ConfigRepo,
): Promise<GetPvpOpponentResponse> {
  const daily = await readDaily(storage, now);
  const lineup = profile.lineup
    .map((id) => profile.pets[id])
    .filter((pet): pet is PetInstance => Boolean(pet) && pet.stage !== 'egg');
  const pool = nonEggPets(profile);
  const avg = averageLevel(lineup.length > 0 ? lineup : pool);

  const seeds = hash(`${profile.accountId}:${Math.floor(now / 60_000)}:${profile.pvp.rating}:${profile.revision}`);
  const speciesList = cfg.allSpecies().map((species) => species.id);
  const count = clamp((seeds % 3) + 1, 1, Math.min(3, speciesList.length));
  const speciesPreview: string[] = [];
  for (let index = 0; index < count; index += 1) {
    // 必须用无符号右移：hash 可能带符号位，负数取模会得到负下标 → undefined。
    const slot = (seeds >>> (index * 3)) % speciesList.length;
    const picked = speciesList[slot < 0 ? slot + speciesList.length : slot] ?? speciesList[0];
    if (picked) speciesPreview.push(picked);
  }

  const isBot = seeds % 10 < 4;
  const speciesForName = speciesPreview[0] ?? speciesList[0] ?? 'turtle';
  const nameSlot = (seeds >>> 7) % OPPONENT_NAMES.length;
  const displayName = isBot
    ? `训练师·${cfg.species(speciesForName).name}`
    : `训练师·${OPPONENT_NAMES[nameSlot < 0 ? nameSlot + OPPONENT_NAMES.length : nameSlot]}`;
  const accountId = isBot ? `bot-${speciesForName}-${seeds % 97}` : `mock-${seeds % 9973}`;
  const rating = isBot
    ? MOCK_PVP_LIMIT.initialRating
    : clamp(profile.pvp.rating + ((seeds % 301) - 150), 0, 5000);
  const levelOffset = (seeds >>> 5) % 5;
  const avgLevel = clamp(Math.round(avg) + levelOffset - 2, 1, 20);

  const opponent: PvpOpponentSummary = {
    accountId,
    displayName,
    rating,
    petCount: speciesPreview.length,
    speciesPreview,
    avgLevel,
    isBot,
  };

  return {
    opponent,
    challengesRemaining: remainingOf(daily),
    dailyLimit: MOCK_PVP_LIMIT.dailyChallenges,
    seasonId: profile.pvp.seasonId,
    serverTime: now,
  };
}

function elementForSpecies(cfg: ConfigRepo, speciesId: string): ElementId {
  const species = cfg.species(speciesId);
  return (species.habitatTags[0] ?? 'water') as ElementId;
}

function genomeFor(seed: number, speciesId: string, elementId: ElementId): Genome {
  const pick = (offset: number): number => 40 + ((seed >>> offset) % 41);
  return {
    stats: { hp: pick(0), atk: pick(3), def: pick(6), spd: pick(9) },
    speciesAlleles: [speciesId, speciesId],
    elementAlleles: [elementId, elementId],
    traitAlleles: [],
    mutationCount: 0,
  };
}

/** 生成对手队伍（1~3 只成年宠物）；等级 = 对手 avgLevel，状态满值。 */
export function mockOpponentTeam(opponent: PvpOpponentSummary, now: EpochMs, cfg: ConfigRepo): PetInstance[] {
  return opponent.speciesPreview.slice(0, 3).map((speciesId, index) => {
    const seed = hash(`${opponent.accountId}:${index}`);
    const elementId = elementForSpecies(cfg, speciesId);
    const pet = createPet(
      {
        id: `mock-${opponent.accountId}-${index}`,
        speciesId,
        elementId,
        genome: genomeFor(seed, speciesId, elementId),
        traits: [],
        hiddenTraits: [],
        gender: index % 2 === 0 ? 'male' : 'female',
        generation: 1,
        level: clamp(opponent.avgLevel, 1, 20),
        now: now - 3 * 24 * 60 * 60 * 1000,
      },
      cfg,
    );
    return advancePet(pet, now, cfg).pet;
  });
}

function simulate(
  attacker: readonly PetInstance[],
  defender: readonly PetInstance[],
  cfg: ConfigRepo,
  seed: number,
): { setup: ReturnType<typeof buildBattleSetup>; commands: Command[]; events: BattleEvent[]; winner: 0 | 1 | null; turns: number } {
  const setup = buildBattleSetup([attacker, defender], cfg, seed);
  const engine = BattleEngine.create(setup, cfg);
  const commands: Command[] = [];
  let guard = 0;
  while (engine.state.phase !== 'finished' && guard < 600) {
    guard += 1;
    const state = engine.state;
    const uid = state.order[state.cursor];
    if (!uid) break;
    const command = engine.autoCommand(uid);
    commands.push(command);
    engine.submit(command);
  }
  const state = engine.state;
  const winner = state.phase === 'finished' ? state.winner : null;
  const turns = Math.min(30, Math.max(1, state.turn));
  return { setup, commands, events: [...state.log], winner, turns };
}

function elo(winner: 0 | 1 | null, ratingA: number, ratingB: number): number {
  const expected = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const score = winner === 0 ? 1 : winner === 1 ? 0 : 0.5;
  const k = winner === 0 ? MOCK_PVP_LIMIT.kWin : winner === 1 ? MOCK_PVP_LIMIT.kLoss : MOCK_PVP_LIMIT.kDraw;
  return Math.round(k * (score - expected));
}

async function saveReplay(storage: MockPvpStorage, stored: StoredReplay): Promise<void> {
  const bag = (await storage.get<ReplayBag>(MOCK_PVP_KEYS.replay)) ?? {};
  bag[stored.summary.replayId] = stored;
  const ordered = Object.entries(bag).sort((a, b) => b[1].summary.createdAt - a[1].summary.createdAt);
  const kept: ReplayBag = {};
  for (const [id, item] of ordered.slice(0, MOCK_PVP_LIMIT.historyLimit)) kept[id] = item;
  await storage.set(MOCK_PVP_KEYS.replay, kept);
}

export interface MockFightResult {
  response: FightPvpResponse;
  profile: Profile;
  replay: BattleReplay;
  summary: PvpReplaySummary;
}

export async function mockFight(
  profile: Profile,
  opponent: PvpOpponentSummary,
  storage: MockPvpStorage,
  now: EpochMs,
  cfg: ConfigRepo,
): Promise<MockFightResult> {
  if (opponent.accountId === profile.accountId) {
    throw new MockPvpError('OPPONENT_UNAVAILABLE', '不能挑战自己');
  }
  const daily = await readDaily(storage, now);
  if (remainingOf(daily) <= 0) {
    throw new MockPvpError('DAILY_LIMIT_REACHED', '今日 PvP 次数已用完');
  }

  const attacker = attackerPets(profile);
  const defender = mockOpponentTeam(opponent, now, cfg);
  if (defender.length === 0) throw new MockPvpError('OPPONENT_UNAVAILABLE', '对手没有可用防守阵容');

  const seed = hash(`${profile.accountId}:${profile.revision}:${opponent.accountId}:${now}`) >>> 0 || 1;
  const battle = simulate(attacker, defender, cfg, seed);

  const ratingBefore = profile.pvp.rating;
  const delta = elo(battle.winner, ratingBefore, opponent.rating);
  const ratingAfter = opponent.isBot ? ratingBefore : Math.max(0, ratingBefore + delta);
  const opponentAfter = opponent.isBot ? opponent.rating : Math.max(0, opponent.rating - delta);

  const stats: ProfileStats = { ...profile.stats };
  if (battle.winner === 0) stats.battlesWon += 1;
  if (battle.winner === 1) stats.battlesLost += 1;

  const patch: ProfilePatch = {
    fromRevision: profile.revision,
    toRevision: profile.revision + 1,
    at: now,
    lastEvaluatedAt: profile.lastEvaluatedAt,
    pvp: { ...profile.pvp, rating: ratingAfter },
    stats,
  };
  const next = applyProfilePatch(profile, patch);

  const replayId = `mock-replay-${(hash(`${opponent.accountId}:${now}:${profile.revision}`) >>> 0).toString(36)}`;
  const replay: BattleReplay = {
    version: cfg.contentVersion,
    setup: battle.setup,
    seed,
    commands: battle.commands,
    events: battle.events,
    winner: battle.winner,
    turns: battle.turns,
  };
  const summary: PvpReplaySummary = {
    replayId,
    seasonId: profile.pvp.seasonId,
    createdAt: now,
    attacker: {
      accountId: profile.accountId,
      displayName: '你',
      ratingBefore,
      ratingAfter,
    },
    defender: {
      accountId: opponent.accountId,
      displayName: opponent.displayName,
      ratingBefore: opponent.rating,
      ratingAfter: opponentAfter,
    },
    resultForAttacker: battle.winner,
    isBot: opponent.isBot,
  };
  await saveReplay(storage, { replay, summary });

  const nextDaily: StoredDaily = {
    day: daily.day,
    used: daily.used + 1,
  };
  await storage.set(MOCK_PVP_KEYS.daily, nextDaily);

  if (!opponent.isBot) {
    const ranked = await readRanked(storage, profile.pvp.seasonId);
    await storage.set(MOCK_PVP_KEYS.ranked, { seasonId: profile.pvp.seasonId, played: ranked.played + 1 });
  }

  const response: FightPvpResponse = {
    patch,
    revision: next.revision,
    serverTime: now,
    replayId,
    result: battle.winner,
    turns: battle.turns,
    isBot: opponent.isBot,
    seasonId: profile.pvp.seasonId,
    ratingBefore,
    ratingAfter,
    challengesRemaining: remainingOf(nextDaily),
    opponent: {
      accountId: opponent.accountId,
      displayName: opponent.displayName,
      ratingBefore: opponent.rating,
      ratingAfter: opponentAfter,
      isBot: opponent.isBot,
    },
  };

  return { response, profile: next, replay, summary };
}

export async function mockGetReplay(
  replayId: string,
  storage: MockPvpStorage,
  now: EpochMs,
): Promise<GetPvpReplayResponse> {
  const bag = (await storage.get<ReplayBag>(MOCK_PVP_KEYS.replay)) ?? {};
  const stored = bag[replayId];
  if (!stored) throw new MockPvpError('NOT_FOUND', '战报不存在');
  if (now > stored.summary.createdAt + MOCK_PVP_LIMIT.replayTtlMs) {
    throw new MockPvpError('REPLAY_EXPIRED', '战报已过期');
  }
  return { replay: stored.replay, summary: stored.summary, serverTime: now };
}

interface LeaderRow {
  accountId: string;
  displayName: string;
  value: number;
  rating: number;
}

function selfRow(profile: Profile, kind: LeaderboardKind, rankedPlayed: number): LeaderRow | null {
  const pets = nonEggPets(profile);
  if (kind === 'rating') {
    if (rankedPlayed < 1) return null;
    return { accountId: profile.accountId, displayName: '你', value: profile.pvp.rating, rating: profile.pvp.rating };
  }
  if (pets.length === 0) return null;
  if (kind === 'codex') {
    const owned = Object.values(profile.codex).filter((entry) => entry.owned).length;
    if (owned === 0) return null;
    return { accountId: profile.accountId, displayName: '你', value: owned, rating: profile.pvp.rating };
  }
  if (kind === 'gene') {
    const best = pets.reduce((max, pet) => {
      const stats = pet.genome.stats;
      const value = Math.floor((stats.hp + stats.atk + stats.def + stats.spd) / 4);
      return Math.max(max, value);
    }, 0);
    return { accountId: profile.accountId, displayName: '你', value: best, rating: profile.pvp.rating };
  }
  const generation = pets.reduce((max, pet) => Math.max(max, pet.generation), 1);
  return { accountId: profile.accountId, displayName: '你', value: generation, rating: profile.pvp.rating };
}

function fakeLeaderRows(kind: LeaderboardKind): LeaderRow[] {
  return OPPONENT_NAMES.map((name, index) => {
    const seed = hash(`leaderboard:${kind}:${index}`);
    const rating = 900 + (seed % 500);
    let value: number;
    if (kind === 'rating') value = rating;
    else if (kind === 'codex') value = 1 + (seed % 25);
    else if (kind === 'gene') value = 20 + (seed % 81);
    else value = 1 + (seed % 12);
    return { accountId: `mock-lb-${kind}-${index}`, displayName: name, value, rating };
  });
}

export async function mockLeaderboard(
  profile: Profile,
  kind: LeaderboardKind,
  storage: MockPvpStorage,
  now: EpochMs,
  limit = 20,
): Promise<LeaderboardResponse> {
  const ranked = await readRanked(storage, profile.pvp.seasonId);
  const rankedPlayed = ranked.played;
  const rows = fakeLeaderRows(kind);
  const self = selfRow(profile, kind, rankedPlayed);
  const all = self ? [...rows, self] : rows;
  all.sort((a, b) => b.value - a.value || b.rating - a.rating || a.accountId.localeCompare(b.accountId));

  const toEntry = (row: LeaderRow, index: number): LeaderboardEntry => ({
    rank: index + 1,
    accountId: row.accountId,
    displayName: row.displayName,
    value: row.value,
  });

  const top = all.slice(0, clamp(limit, 1, 50)).map(toEntry);
  const selfIndex = self ? all.findIndex((row) => row.accountId === self.accountId) : -1;

  return {
    kind,
    seasonId: profile.pvp.seasonId,
    entries: top,
    self: selfIndex >= 0 ? toEntry(all[selfIndex], selfIndex) : undefined,
    selfEligible: self !== null,
    serverTime: now,
  };
}
