/**
 * 排行榜（CONTRACT §7.5 F-05）。
 *
 * Demo 2C2G 不上 Redis：直接扫描 Postgres/内存里的全量存档，
 * 按 `value desc → rating desc → accountId asc` 排序，取前 N + 自己。
 * M3 数据量上来后再换 Redis Sorted Set，接口不变。
 */
import type { LeaderboardKind, LeaderboardQuery, LeaderboardResponse } from '@petbattle/protocol';

import type { PvpSettings } from '../config.js';
import { leaderboardValue, rolloverSeason } from '../domain/pvp-rules.js';
import { AppError } from '../errors.js';
import type { Store } from '../storage/types.js';

const KINDS: readonly LeaderboardKind[] = ['rating', 'codex', 'gene', 'generation'];

export interface LeaderboardServiceDeps {
  store: Store;
  settings: PvpSettings;
}

interface Row {
  accountId: string;
  displayName: string;
  value: number;
  rating: number;
}

export class LeaderboardService {
  constructor(private readonly deps: LeaderboardServiceDeps) {}

  async get(accountId: string, query: LeaderboardQuery, now: number): Promise<LeaderboardResponse> {
    const kind = parseKind(query.kind);
    const seasonId = query.seasonId ?? this.deps.settings.seasonId;
    if (seasonId !== this.deps.settings.seasonId) {
      throw new AppError('VALIDATION_FAILED', `M2 只支持当前赛季 ${this.deps.settings.seasonId}`);
    }
    const limit = parseLimit(query.limit, this.deps.settings);

    const [profiles, accounts] = await Promise.all([
      this.deps.store.listProfiles(),
      this.deps.store.listAccounts(),
    ]);
    const accountMap = new Map(accounts.map((account) => [account.id, account] as const));

    const rows: Row[] = [];
    for (const profile of profiles) {
      const account = accountMap.get(profile.accountId);
      // 机器人没有 profile；封禁/删除账号不进榜。
      if (account === undefined || account.status !== 'active') continue;

      const rolled = rolloverSeason(profile, this.deps.settings).profile;
      const { eligible, value } = leaderboardValue(kind, rolled);
      if (!eligible) continue;

      rows.push({
        accountId: profile.accountId,
        displayName: account.displayName,
        value,
        rating: rolled.pvp.rating,
      });
    }

    rows.sort((a, b) => {
      if (a.value !== b.value) return b.value - a.value;
      if (a.rating !== b.rating) return b.rating - a.rating;
      return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
    });

    const entries = rows.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      accountId: row.accountId,
      displayName: row.displayName,
      value: row.value,
    }));

    const selfIndex = rows.findIndex((row) => row.accountId === accountId);
    const selfRow = selfIndex >= 0 ? rows[selfIndex] : undefined;

    return {
      kind,
      seasonId,
      entries,
      ...(selfRow === undefined
        ? {}
        : {
            self: {
              rank: selfIndex + 1,
              accountId: selfRow.accountId,
              displayName: selfRow.displayName,
              value: selfRow.value,
            },
          }),
      selfEligible: selfRow !== undefined,
      serverTime: now,
    };
  }
}

function parseKind(input: unknown): LeaderboardKind {
  if (typeof input !== 'string' || !KINDS.includes(input as LeaderboardKind)) {
    throw new AppError('VALIDATION_FAILED', `kind 必须是 ${KINDS.join(' | ')} 之一`);
  }
  return input as LeaderboardKind;
}

function parseLimit(input: number | undefined, settings: PvpSettings): number {
  if (input === undefined) return settings.leaderboardDefaultLimit;
  if (!Number.isInteger(input) || input < 1) {
    throw new AppError('VALIDATION_FAILED', 'limit 必须是正整数');
  }
  return Math.min(input, settings.leaderboardMaxLimit);
}
