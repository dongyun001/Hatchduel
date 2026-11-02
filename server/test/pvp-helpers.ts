/**
 * PvP 测试公共步骤：登录 → 编队 → 防守 → 对战。
 *
 * 这里只做 HTTP 编排，断言语义留在各测试文件；避免每个用例重复拼 header。
 */
import type { Profile } from '@petbattle/core';
import type {
  AuthResponse,
  FightPvpResponse,
  GetPvpDefenseResponse,
  GetPvpOpponentResponse,
  GetPvpReplayResponse,
  ProfileWriteResponse,
} from '@petbattle/protocol';

import {
  authHeaders,
  get,
  guestLogin,
  loadProfile,
  post,
  type HttpCall,
  type HttpHarness,
  type StoreHarness,
} from './helpers.js';

export type PvpHarness = HttpHarness & StoreHarness;

export interface PvpAccount {
  accountId: string;
  token: string;
  deviceId: string;
}

export async function loginPvp(harness: PvpHarness, deviceId: string): Promise<PvpAccount> {
  const login = await guestLogin(harness, deviceId);
  const data = login.data as AuthResponse;
  return { accountId: data.account.id, token: data.token, deviceId };
}

export async function profileOf(harness: PvpHarness, account: PvpAccount): Promise<Profile> {
  return loadProfile(harness, account.accountId);
}

export function writeHeaders(
  account: PvpAccount,
  key: string,
  revision: number,
): Record<string, string> {
  return {
    ...authHeaders(account.token),
    'idempotency-key': key,
    'x-base-revision': String(revision),
  };
}

export async function setLineup(
  harness: PvpHarness,
  account: PvpAccount,
  petIds: string[],
  key: string,
): Promise<HttpCall> {
  const profile = await profileOf(harness, account);
  return post(harness, '/lineup/set', { petIds }, writeHeaders(account, key, profile.revision));
}

export async function setDefense(
  harness: PvpHarness,
  account: PvpAccount,
  petIds: string[],
  key: string,
  baseRevision?: number,
): Promise<HttpCall> {
  const revision = baseRevision ?? (await profileOf(harness, account)).revision;
  return post(harness, '/pvp/defense', { petIds }, writeHeaders(account, key, revision));
}

export async function getDefense(harness: PvpHarness, account: PvpAccount): Promise<HttpCall> {
  return get(harness, '/pvp/defense', authHeaders(account.token));
}

export async function getOpponent(harness: PvpHarness, account: PvpAccount): Promise<HttpCall> {
  return get(harness, '/pvp/opponent', authHeaders(account.token));
}

export async function fight(
  harness: PvpHarness,
  account: PvpAccount,
  opponentAccountId: string,
  key: string,
  revision?: number,
): Promise<HttpCall> {
  const current = revision ?? (await profileOf(harness, account)).revision;
  return post(harness, '/pvp/fight', { opponentAccountId }, writeHeaders(account, key, current));
}

export async function getReplay(
  harness: PvpHarness,
  account: PvpAccount,
  replayId: string,
): Promise<HttpCall> {
  return get(harness, `/pvp/replay/${encodeURIComponent(replayId)}`, authHeaders(account.token));
}

/** 把一个新账号准备成可对战状态：编队 3 只 + 防守 3 只。 */
export async function prepareFighter(
  harness: PvpHarness,
  account: PvpAccount,
  prefix: string,
): Promise<{ petIds: string[]; revision: number }> {
  const profile = await profileOf(harness, account);
  const petIds = Object.values(profile.pets)
    .filter((pet) => pet.stage !== 'egg')
    .slice(0, 3)
    .map((pet) => pet.id);

  const lineup = await setLineup(harness, account, petIds, `${prefix}-lineup`);
  if (lineup.status !== 200) throw new Error(`编队失败：${JSON.stringify(lineup.body)}`);

  const defense = await setDefense(harness, account, petIds, `${prefix}-defense`);
  if (defense.status !== 200) throw new Error(`防守失败：${JSON.stringify(defense.body)}`);

  return { petIds, revision: (await profileOf(harness, account)).revision };
}

export function defenseOf(call: HttpCall): GetPvpDefenseResponse {
  return call.body.data as GetPvpDefenseResponse;
}

export function opponentOf(call: HttpCall): GetPvpOpponentResponse {
  return call.body.data as GetPvpOpponentResponse;
}

export function fightOf(call: HttpCall): FightPvpResponse {
  return call.body.data as FightPvpResponse;
}

export function replayOf(call: HttpCall): GetPvpReplayResponse {
  return call.body.data as GetPvpReplayResponse;
}

export function writeOf(call: HttpCall): ProfileWriteResponse {
  return call.body.data as ProfileWriteResponse;
}
