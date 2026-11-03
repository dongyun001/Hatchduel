/* global console, process, fetch */
/**
 * 真实服务端 PvP 两账号验收（客户端 ApiClient 直连，不经过 Cocos）。
 *
 * 运行前先起一个干净的内存服务端：
 *   PETBATTLE_STORE=memory PORT=3101 pnpm dev
 *
 * 运行：
 *   pnpm exec tsx client/tools/verify-server-pvp.ts
 *   PETBATTLE_API_URL=http://127.0.0.1:3000 pnpm exec tsx client/tools/verify-server-pvp.ts
 *
 * 覆盖：
 * - 两个新游客账号各设编队 + 防守；
 * - A 匹配到 B（不出现自己）→ fight → 幂等重放 → 读回放；
 * - B 的 GET /profile 看到防守方 rating/stats 变化；
 * - B 反打 A → A 的下一次 GET /profile 变化；
 * - 四榜前 N + self；
 * - 409 自己/不存在对手、INVALID_LINEUP、PET_IN_USE、409 REVISION_CONFLICT。
 */
import { applyProfilePatch } from '../assets/lib/core';
import type { Profile } from '../assets/lib/core';
import type { ApiResponse, LeaderboardKind } from '../assets/lib/protocol';
import { ApiClient } from '../assets/scripts/services/apiClient';
import type { HttpRequest, HttpResponse, PlatformAdapter, PlatformLoginResult } from '../assets/scripts/platform/types';

const BASE_URL = process.env.PETBATTLE_API_URL ?? 'http://127.0.0.1:3101';

class NodePlatform implements PlatformAdapter {
  readonly kind = 'web' as const;

  constructor(private readonly deviceId: string) {}

  login(): Promise<PlatformLoginResult> {
    return Promise.resolve({ kind: 'web', credential: this.deviceId });
  }

  getStorage<T>(_key: string): Promise<T | null> {
    return Promise.resolve(null);
  }

  setStorage<T>(_key: string, value: T): Promise<void> {
    void value;
    return Promise.resolve();
  }

  now(): number {
    return Date.now();
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return { status: response.status, body: await response.text() };
  }
}

interface AccountClient {
  id: string;
  deviceId: string;
  api: ApiClient;
  profile: () => Profile;
  apply: (patch: Parameters<typeof applyProfilePatch>[1]) => void;
  sync: () => Promise<Profile>;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function codeOf<T>(response: ApiResponse<T>): string | undefined {
  return response.ok ? undefined : response.error?.code;
}

async function createAccount(label: string): Promise<AccountClient> {
  const deviceId = `verify-${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  let profile: Profile | null = null;
  const api = new ApiClient({
    baseUrl: BASE_URL,
    platform: new NodePlatform(deviceId),
    getBaseRevision: () => profile?.revision ?? 0,
    onProfile: (next) => {
      profile = next;
    },
  });
  const auth = await api.login();
  const synced = await api.syncProfile();
  if (!synced) throw new Error(`${label}: 登录后拉档失败`);
  profile = synced;
  return {
    id: auth.account.id,
    deviceId,
    api,
    profile: () => {
      if (!profile) throw new Error(`${label}: profile 为空`);
      return profile;
    },
    apply: (patch) => {
      if (!profile) throw new Error(`${label}: profile 为空`);
      profile = applyProfilePatch(profile, patch);
    },
    sync: async () => {
      const next = await api.syncProfile();
      if (!next) throw new Error(`${label}: GET /profile 失败`);
      profile = next;
      return next;
    },
  };
}

async function setup(account: AccountClient, label: string): Promise<{ lineup: string[]; defense: string[] }> {
  const pets = Object.values(account.profile().pets).filter((pet) => pet.stage !== 'egg');
  check(pets.length >= 3, `${label}: 初始宠物不足 3 只`);
  const lineup = pets.slice(0, 3).map((pet) => pet.id);
  const defense = pets.slice(0, 2).map((pet) => pet.id);

  const lineupRes = await account.api.setLineup({ petIds: lineup });
  if (!lineupRes.ok || !lineupRes.data) throw new Error(`${label}: setLineup 失败 ${codeOf(lineupRes)}`);
  account.apply(lineupRes.data.patch);

  const defenseRes = await account.api.setPvpDefense({ petIds: defense });
  if (!defenseRes.ok || !defenseRes.data) throw new Error(`${label}: setDefense 失败 ${codeOf(defenseRes)}`);
  account.apply(defenseRes.data.patch);
  return { lineup, defense };
}

async function setLineupOnly(account: AccountClient, label: string): Promise<string[]> {
  const pets = Object.values(account.profile().pets).filter((pet) => pet.stage !== 'egg');
  check(pets.length >= 1, `${label}: 初始宠物不足`);
  const lineup = pets.slice(0, 3).map((pet) => pet.id);
  const res = await account.api.setLineup({ petIds: lineup });
  if (!res.ok || !res.data) throw new Error(`${label}: setLineup 失败 ${codeOf(res)}`);
  account.apply(res.data.patch);
  return lineup;
}

async function scenarioBot(): Promise<void> {
  const account = await createAccount('bot');
  await setLineupOnly(account, 'BOT');
  const opponent = await account.api.getPvpOpponent();
  if (!opponent.ok || !opponent.data) throw new Error(`bot 匹配失败：${codeOf(opponent)}`);
  check(opponent.data.opponent.isBot === true, '干净服务端单账号应匹配到机器人');
  const before = account.profile().pvp.rating;
  const fight = await account.api.fightPvp({ opponentAccountId: opponent.data.opponent.accountId }, `bot-${Date.now()}`);
  if (!fight.ok || !fight.data) throw new Error(`bot fight 失败：${codeOf(fight)}`);
  check(fight.data.isBot === true, 'fight 响应 isBot 应为 true');
  check(fight.data.ratingAfter === before, '机器人对局不应改 rating');
  const board = await account.api.getLeaderboard({ kind: 'rating', limit: 20 });
  if (!board.ok || !board.data) throw new Error(`bot 后排行榜失败：${codeOf(board)}`);
  check(board.data.selfEligible === false, '只打机器人不应上 rating 榜');
  check(board.data.entries.every((entry) => !entry.accountId.startsWith('bot_')), '机器人不应上榜');
  console.log(
    `PASS 机器人兜底：isBot=true name=${opponent.data.opponent.displayName} rating 不变（${before}）且不计榜`,
  );
}

async function scenarioDaily(): Promise<void> {
  const account = await createAccount('daily');
  await setLineupOnly(account, 'DAILY');
  const first = await account.api.getPvpOpponent();
  if (!first.ok || !first.data) throw new Error(`daily 匹配失败：${codeOf(first)}`);
  const one = await account.api.fightPvp({ opponentAccountId: first.data.opponent.accountId }, `daily-1-${Date.now()}`);
  if (!one.ok || !one.data) throw new Error(`第 1 次 fight 应成功：${codeOf(one)}`);
  account.apply(one.data.patch);
  const two = await account.api.fightPvp({ opponentAccountId: first.data.opponent.accountId }, `daily-2-${Date.now()}`);
  check(codeOf(two) === 'DAILY_LIMIT_REACHED', `第 2 次应 DAILY_LIMIT_REACHED，实际 ${codeOf(two)}`);
  console.log('PASS 日报边界：PETBATTLE_PVP_DAILY_LIMIT=1 时第 2 次 429');
}

async function scenarioSnapshot(): Promise<void> {
  const account = await createAccount('snapshot');
  const pets = Object.values(account.profile().pets).filter((pet) => pet.stage !== 'egg');
  const defense = pets.slice(0, 2).map((pet) => pet.id);
  const set = await account.api.setPvpDefense({ petIds: defense });
  if (!set.ok || !set.data) throw new Error(`setDefense 失败：${codeOf(set)}`);
  account.apply(set.data.patch);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const info = await account.api.getPvpDefense();
  if (!info.ok || !info.data) throw new Error(`GET /pvp/defense 失败：${codeOf(info)}`);
  check(info.data.defense?.stale === true, '超过 TTL 的快照应 stale=true');
  console.log('PASS 快照边界：PETBATTLE_PVP_SNAPSHOT_TTL_MS=1000 后 stale=true');
}

async function scenarioReplay(): Promise<void> {
  const account = await createAccount('replay');
  await setLineupOnly(account, 'REPLAY');
  const opponent = await account.api.getPvpOpponent();
  if (!opponent.ok || !opponent.data) throw new Error(`replay 匹配失败：${codeOf(opponent)}`);
  const fight = await account.api.fightPvp(
    { opponentAccountId: opponent.data.opponent.accountId },
    `replay-${Date.now()}`,
  );
  if (!fight.ok || !fight.data) throw new Error(`replay fight 失败：${codeOf(fight)}`);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const expired = await account.api.getPvpReplay(fight.data.replayId);
  check(codeOf(expired) === 'REPLAY_EXPIRED', `超过 TTL 应 REPLAY_EXPIRED，实际 ${codeOf(expired)}`);
  console.log('PASS 回放边界：PETBATTLE_PVP_REPLAY_TTL_MS=1000 后 410');
}

async function main(): Promise<void> {
  const scenario = process.env.VERIFY_SCENARIO ?? 'two-account';
  if (scenario === 'bot') return scenarioBot();
  if (scenario === 'daily') return scenarioDaily();
  if (scenario === 'snapshot') return scenarioSnapshot();
  if (scenario === 'replay') return scenarioReplay();

  const a = await createAccount('a');
  const b = await createAccount('b');
  check(a.id !== b.id, '两个游客账号不能相同');


  const aSetup = await setup(a, 'A');
  await setup(b, 'B');
  console.log(`PASS 两账号建号：A=${a.id} B=${b.id}`);

  // A 匹配 B（干净内存库里只有 A/B）
  const opponent = await a.api.getPvpOpponent();
  check(opponent.ok && opponent.data !== undefined, `A 匹配失败 ${codeOf(opponent)}`);
  check(opponent.data.opponent.accountId !== a.id, '匹配不能返回自己');
  check(opponent.data.opponent.accountId === b.id, `A 应匹配到 B，实际 ${opponent.data.opponent.accountId}`);
  check(opponent.data.opponent.isBot === false, 'A 应匹配到真人 B');
  console.log(
    `PASS A 匹配 B：${opponent.data.opponent.displayName} rating=${opponent.data.opponent.rating} ` +
      `avgLv=${opponent.data.opponent.avgLevel} preview=${opponent.data.opponent.speciesPreview.join(',')}`,
  );

  const bBefore = b.profile();
  const fightKey = `verify-fight-${Date.now().toString(36)}`;
  const fightBaseRevision = a.profile().revision;
  const fight = await a.api.fightPvp({ opponentAccountId: b.id }, fightKey, fightBaseRevision);
  if (!fight.ok || !fight.data) throw new Error(`A fight B 失败：${codeOf(fight)}`);
  const result = fight.data;
  check(result.replayId.length > 0, 'fight 缺少 replayId');
  check(result.seasonId === 's1', `seasonId 应为 s1，实际 ${result.seasonId}`);
  check(result.challengesRemaining >= 0, 'challengesRemaining 非法');
  a.apply(result.patch);
  console.log(
    `PASS A fight B：result=${String(result.result)} turns=${result.turns} ` +
      `rating ${result.ratingBefore}→${result.ratingAfter}，对手 ${result.opponent.ratingBefore}→${result.opponent.ratingAfter}`,
  );

  // 幂等重放：同一 key 返回同一 replayId，且不重复扣次数
  const replaySameKey = await a.api.fightPvp(
    { opponentAccountId: b.id },
    fightKey,
    fightBaseRevision,
  );
  if (!replaySameKey.ok || !replaySameKey.data) throw new Error(`幂等重放失败：${codeOf(replaySameKey)}`);
  check(replaySameKey.data.replayId === result.replayId, '同一 Idempotency-Key 应返回同一 replayId');
  check(
    replaySameKey.data.challengesRemaining === result.challengesRemaining,
    '幂等重放不应重复扣次数',
  );
  console.log('PASS fight 幂等重放：replayId 相同、次数不变');

  const replay = await a.api.getPvpReplay(result.replayId);
  if (!replay.ok || !replay.data) throw new Error(`A 读回放失败：${codeOf(replay)}`);
  const events = replay.data.replay.events ?? [];
  check(events.length > 0, '回放 events 为空');
  check(events[events.length - 1]?.type === 'battleEnd', '回放最后事件不是 battleEnd');
  console.log(`PASS A 读回放：events=${events.length} turns=${replay.data.replay.turns}`);

  // B 下一次 GET /profile：防守方统计与 rating 变化
  const bAfter = await b.sync();
  check(bAfter.revision > bBefore.revision, 'B 的 revision 未推进');
  check(bAfter.pvp.rating === result.opponent.ratingAfter, 'B rating 与 fight 响应不一致');
  const lost = result.result === 0;
  const won = result.result === 1;
  if (won) {
    check(bAfter.stats.battlesWon === bBefore.stats.battlesWon + 1, 'B battlesWon 未 +1');
  } else if (lost) {
    check(bAfter.stats.battlesLost === bBefore.stats.battlesLost + 1, 'B battlesLost 未 +1');
  }
  console.log(
    `PASS B GET /profile：rating ${bBefore.pvp.rating}→${bAfter.pvp.rating}，` +
      `won ${bBefore.stats.battlesWon}→${bAfter.stats.battlesWon}，lost ${bBefore.stats.battlesLost}→${bAfter.stats.battlesLost}`,
  );

  // B 反打 A
  const aBefore = a.profile();
  const back = await b.api.getPvpOpponent();
  if (!back.ok || !back.data) throw new Error(`B 匹配失败：${codeOf(back)}`);
  check(back.data.opponent.accountId === a.id, `B 应匹配到 A，实际 ${back.data.opponent.accountId}`);
  const bFight = await b.api.fightPvp({ opponentAccountId: a.id }, `verify-back-${Date.now().toString(36)}`);
  if (!bFight.ok || !bFight.data) throw new Error(`B fight A 失败：${codeOf(bFight)}`);
  b.apply(bFight.data.patch);
  const aAfter = await a.sync();
  check(aAfter.revision > aBefore.revision, 'A 的 revision 未推进');
  check(aAfter.pvp.rating === bFight.data.opponent.ratingAfter, 'A rating 与 B 的 fight 响应不一致');
  console.log(
    `PASS B 反打 A：A rating ${aBefore.pvp.rating}→${aAfter.pvp.rating}，` +
      `A stats W/L=${aAfter.stats.battlesWon}/${aAfter.stats.battlesLost}`,
  );

  // 四榜
  for (const kind of ['rating', 'codex', 'gene', 'generation'] as LeaderboardKind[]) {
    const board = await a.api.getLeaderboard({ kind, limit: 20 });
    if (!board.ok || !board.data) throw new Error(`${kind} 榜失败：${codeOf(board)}`);
    check(board.data.kind === kind, `${kind} 榜类型不匹配`);
    check(board.data.seasonId === 's1', `${kind} 榜 seasonId 不是 s1`);
    check(board.data.entries.length >= 2, `${kind} 榜应至少含 A/B`);
    check(board.data.selfEligible === true, `${kind} 榜 selfEligible 应为 true`);
    check(board.data.self?.accountId === a.id, `${kind} 榜 self 不是 A`);
    check(
      board.data.entries.every((entry) => !entry.accountId.startsWith('bot_')),
      `${kind} 榜不应出现机器人`,
    );
    console.log(`PASS 排行榜 ${kind}：entries=${board.data.entries.length} selfRank=${board.data.self?.rank}`);
  }

  // 错误分支
  const selfFight = await a.api.fightPvp({ opponentAccountId: a.id }, `verify-self-${Date.now().toString(36)}`);
  check(codeOf(selfFight) === 'OPPONENT_UNAVAILABLE', `打自己应 OPPONENT_UNAVAILABLE，实际 ${codeOf(selfFight)}`);

  const missing = await a.api.fightPvp(
    { opponentAccountId: 'acc_missing_verify' },
    `verify-missing-${Date.now().toString(36)}`,
  );
  check(codeOf(missing) === 'OPPONENT_UNAVAILABLE', `不存在对手应 OPPONENT_UNAVAILABLE，实际 ${codeOf(missing)}`);

  const badDefense = await a.api.setPvpDefense({ petIds: [] });
  check(codeOf(badDefense) === 'INVALID_LINEUP', `空防守应 INVALID_LINEUP，实际 ${codeOf(badDefense)}`);

  const releaseDefensePet = await a.api.releasePet(aSetup.defense[0]!);
  check(codeOf(releaseDefensePet) === 'PET_IN_USE', `放生防守宠物应 PET_IN_USE，实际 ${codeOf(releaseDefensePet)}`);
  console.log('PASS 错误分支：OPPONENT_UNAVAILABLE（自己/不存在）、INVALID_LINEUP、PET_IN_USE');

  // 409：第二个客户端用旧 revision 写
  let staleProfile: Profile | null = null;
  const staleApi = new ApiClient({
    baseUrl: BASE_URL,
    platform: new NodePlatform(a.deviceId),
    getBaseRevision: () => 0,
    onProfile: (next) => {
      staleProfile = next;
    },
  });
  await staleApi.login();
  const staleLineup = await staleApi.setLineup({ petIds: aSetup.lineup });
  check(codeOf(staleLineup) === 'REVISION_CONFLICT', `旧 revision 应 409，实际 ${codeOf(staleLineup)}`);
  check(staleProfile !== null, '409 没有用 latestProfile 重建');
  check((staleProfile as Profile | null)?.revision === a.profile().revision, 'latestProfile revision 不匹配');
  console.log('PASS 409 REVISION_CONFLICT 用 latestProfile 重建');
}

void main().catch((error: unknown) => {
  console.error('FAIL', error);
  process.exit(1);
});
