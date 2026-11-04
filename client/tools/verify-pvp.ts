/* global console, process */
/**
 * 离线 PvP 逻辑回归（不依赖 Cocos/服务端）：
 *   pnpm exec tsx client/tools/verify-pvp.ts
 *
 * 覆盖：防守校验/快照过期、匹配不返回自己、真实模拟产出的 events、
 * 战报读取与 30 天过期、每日次数、Elo 只改真人 rating、四个榜单 + selfEligible。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConfigRepo } from '../assets/lib/core';
import type { ConfigData, Profile } from '../assets/lib/core';
import type { PvpOpponentSummary } from '../assets/lib/protocol';
import {
  MOCK_PVP_LIMIT,
  MockPvpError,
  mockFight,
  mockGetDefense,
  mockGetOpponent,
  mockGetReplay,
  mockLeaderboard,
  mockSetDefense,
} from '../assets/scripts/dev/mockPvp';
import type { MockPvpStorage } from '../assets/scripts/dev/mockPvp';
import { createMockProfile } from '../assets/scripts/dev/mockProfile';

const BASE_TIME = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

class MemoryStorage implements MockPvpStorage {
  private readonly map = new Map<string, unknown>();

  get<T>(key: string): Promise<T | null> {
    return Promise.resolve((this.map.get(key) as T | undefined) ?? null);
  }

  set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
}

function loadConfig(): ConfigData {
  const dir = join(process.cwd(), 'client', 'assets', 'resources', 'config');
  const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const content = read('content') as { contentVersion?: string };
  return {
    contentVersion: content.contentVersion ?? '',
    species: read('species'),
    elements: read('elements'),
    affinity: read('affinity'),
    skills: read('skills'),
    passives: read('passives'),
    traits: read('traits'),
    habitats: read('habitats'),
    foods: read('foods'),
    breeding: read('breeding'),
    stages: read('stages'),
    economy: read('economy'),
  } as ConfigData;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function expectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof MockPvpError && error.code === code) return;
    throw new Error(`期望 ${code}，实际：${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`期望抛出 ${code}，实际成功`);
}

async function main(): Promise<void> {
  const cfg = createConfigRepo(loadConfig());
  const storage = new MemoryStorage();
  let profile: Profile = createMockProfile(BASE_TIME, cfg);
  const petIds = Object.keys(profile.pets);

  // —— 防守校验 ——
  await expectCode(() => mockSetDefense(profile, [], storage, BASE_TIME, cfg), 'INVALID_LINEUP');
  await expectCode(() => mockSetDefense(profile, [petIds[0], petIds[0]], storage, BASE_TIME, cfg), 'INVALID_LINEUP');
  await expectCode(() => mockSetDefense(profile, [petIds[0], petIds[1], petIds[2], petIds[0]], storage, BASE_TIME, cfg), 'INVALID_LINEUP');

  const defense = await mockSetDefense(profile, [petIds[0], petIds[1]], storage, BASE_TIME, cfg);
  profile = defense.profile;
  check(profile.pvp.defense.length === 2, '防守阵容未写入 profile.pvp.defense');
  check(defense.info.expiresAt === BASE_TIME + MOCK_PVP_LIMIT.snapshotTtlMs, '快照有效期不是 24h');
  check(!defense.info.stale, '刚设置的快照不应 stale');

  const staleInfo = await mockGetDefense(profile, storage, BASE_TIME + 25 * HOUR, cfg);
  check(staleInfo.defense?.stale === true, '超过 24h 的快照应 stale');

  // —— 匹配 ——
  const opponentRes = await mockGetOpponent(profile, storage, BASE_TIME, cfg);
  check(opponentRes.opponent.accountId !== profile.accountId, '匹配不能返回自己');
  check(opponentRes.challengesRemaining === 10 && opponentRes.dailyLimit === 10, '初始剩余次数应为 10/10');
  check(opponentRes.opponent.speciesPreview.length >= 1 && opponentRes.opponent.speciesPreview.length <= 3, '物种预览应为 1~3');
  check(opponentRes.opponent.avgLevel >= 1 && opponentRes.opponent.avgLevel <= 20, '平均等级应在 1~20');
  const refreshed = await mockGetOpponent(profile, storage, BASE_TIME, cfg);
  check(refreshed.opponent.accountId !== opponentRes.opponent.accountId, '同分钟刷新对手应换人');

  // —— 真人结算：rating 变化 + 战报 events ——
  const human: PvpOpponentSummary = {
    accountId: 'verify-human-1',
    displayName: '训练师·验证',
    rating: profile.pvp.rating + 80,
    petCount: 2,
    speciesPreview: ['cat', 'snake'],
    avgLevel: 5,
    isBot: false,
  };
  const ratingBefore = profile.pvp.rating;
  const fight = await mockFight(profile, human, storage, BASE_TIME, cfg);
  profile = fight.profile;
  check(fight.response.replayId.length > 0, '缺少 replayId');
  check(fight.response.result === 0 || fight.response.result === 1 || fight.response.result === null, 'result 非法');
  check(fight.response.turns >= 1 && fight.response.turns <= 30, `回合数越界：${fight.response.turns}`);
  check(fight.replay.events !== undefined && fight.replay.events.length > 0, '战报没有 events');
  const lastEvent = fight.replay.events[fight.replay.events.length - 1];
  check(lastEvent?.type === 'battleEnd', `最后一个事件应为 battleEnd，实际 ${lastEvent?.type}`);
  check(profile.pvp.rating !== ratingBefore, '真人结算后 rating 应变化');
  check(fight.response.challengesRemaining === 9, 'fight 后剩余次数应为 9');

  // —— 回放：events 原样返回，不重算 ——
  const replay = await mockGetReplay(fight.response.replayId, storage, BASE_TIME + 1000);
  check(JSON.stringify(replay.replay.events) === JSON.stringify(fight.replay.events), '回放 events 与战报不一致');
  check(replay.summary.replayId === fight.response.replayId, '回放 summary 不匹配');

  // —— 机器人：rating 不变 ——
  const bot: PvpOpponentSummary = { ...human, accountId: 'bot-verify', displayName: '训练师·龟', isBot: true };
  const botFight = await mockFight(profile, bot, storage, BASE_TIME + HOUR, cfg);
  check(botFight.response.ratingAfter === botFight.response.ratingBefore, '机器人对局不应改 rating');

  // —— 每日次数：第 11 次拒绝 ——
  let dailyProfile = createMockProfile(BASE_TIME, cfg);
  const dailyStorage = new MemoryStorage();
  for (let index = 0; index < MOCK_PVP_LIMIT.dailyChallenges; index += 1) {
    const fake: PvpOpponentSummary = {
      ...human,
      accountId: `verify-daily-${index}`,
      rating: 1000,
    };
    const result = await mockFight(dailyProfile, fake, dailyStorage, BASE_TIME + index * 1000, cfg);
    dailyProfile = result.profile;
  }
  await expectCode(
    () => mockFight(dailyProfile, { ...human, accountId: 'verify-daily-11' }, dailyStorage, BASE_TIME + 20_000, cfg),
    'DAILY_LIMIT_REACHED',
  );

  // —— 回放 30 天过期 ——
  await expectCode(
    () => mockGetReplay(fight.response.replayId, storage, BASE_TIME + 31 * DAY),
    'REPLAY_EXPIRED',
  );

  // —— 排行榜：四个 kind + selfEligible ——
  for (const kind of ['rating', 'codex', 'gene', 'generation'] as const) {
    const board = await mockLeaderboard(profile, kind, storage, BASE_TIME);
    check(board.kind === kind, `榜单类型不匹配：${board.kind}`);
    check(board.entries.length > 0, `${kind} 榜单为空`);
    for (let index = 1; index < board.entries.length; index += 1) {
      check(board.entries[index - 1].value >= board.entries[index].value, `${kind} 榜单未按 value 降序`);
    }
    check(board.entries.every((entry) => !entry.accountId.startsWith('bot-')), `${kind} 榜单出现机器人`);
    if (kind === 'rating') {
      check(board.selfEligible === true, '打过真人排位后 rating 榜应可上榜');
      check(board.self?.accountId === profile.accountId, 'rating 榜缺少 self');
    }
    if (kind === 'codex' || kind === 'gene' || kind === 'generation') {
      check(board.selfEligible === true, `${kind} 榜应可上榜`);
    }
  }
  const nextDayBoard = await mockLeaderboard(profile, 'rating', storage, BASE_TIME + 2 * DAY);
  check(nextDayBoard.selfEligible === true, 'ranked 资格不应随每日次数清零');

  console.log('PASS 防守校验/24h stale');
  console.log('PASS 匹配不返回自己，剩余次数 10/10');
  console.log(`PASS 真人结算：rating ${ratingBefore} -> ${fight.response.ratingAfter}，回合 ${fight.response.turns}，events ${fight.replay.events.length}`);
  console.log('PASS 回放 events 原样返回；30 天过期 REPLAY_EXPIRED');
  console.log('PASS 机器人对局 rating 不变；第 11 次 DAILY_LIMIT_REACHED');
  console.log('PASS 四个排行榜排序/selfEligible/无机器人');
}

void main().catch((error: unknown) => {
  console.error('FAIL', error);
  process.exit(1);
});
