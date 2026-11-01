import type { Profile } from '../../lib/core';
import { getPlatform } from '../platform';

/**
 * 本地存档（MVP-A："本地存档 + 云存档接口预留"）。
 *
 * - 只缓存 profile：不写 token、密钥、账号凭证；
 * - 服务器权威：server 模式登录/同步后覆盖本地；409 以服务器最新档为准；
 * - mock 模式启动优先读取，时间推进后写回；schemaVersion 不匹配或结构异常时清理并回退新档。
 */
const STORAGE_KEY = 'petbattle.profile.v1';
const SCHEMA_VERSION = 1;

export interface LocalSaveEnvelope {
  schemaVersion: number;
  profile: Profile;
  revision: number;
  savedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function looksLikeProfile(value: unknown): value is Profile {
  if (!isRecord(value)) return false;
  return (
    typeof value['version'] === 'number' &&
    typeof value['revision'] === 'number' &&
    typeof value['accountId'] === 'string' &&
    isRecord(value['pets']) &&
    isRecord(value['currencies']) &&
    isRecord(value['habitats']) &&
    typeof value['lastEvaluatedAt'] === 'number'
  );
}

function isEnvelope(value: unknown): value is LocalSaveEnvelope {
  if (!isRecord(value)) return false;
  return (
    value['schemaVersion'] === SCHEMA_VERSION &&
    typeof value['revision'] === 'number' &&
    typeof value['savedAt'] === 'number' &&
    looksLikeProfile(value['profile'])
  );
}

/** 读取本地档；不存在/版本不符/结构异常返回 null，并尽量清掉坏档。 */
export async function loadLocalSave(): Promise<Profile | null> {
  try {
    const raw = await getPlatform().getStorage<unknown>(STORAGE_KEY);
    if (raw === null || raw === undefined) return null;
    if (!isEnvelope(raw)) {
      await clearLocalSave();
      return null;
    }
    return raw.profile;
  } catch {
    return null;
  }
}

/** 写本地档；失败静默（本地缓存不影响服务器权威）。 */
export async function saveLocalProfile(profile: Profile): Promise<void> {
  try {
    const adapter = getPlatform();
    const envelope: LocalSaveEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      profile,
      revision: profile.revision,
      savedAt: adapter.now(),
    };
    await adapter.setStorage(STORAGE_KEY, envelope);
  } catch {
    // 平台适配器尚未初始化（编辑器单场景预览）或存储失败：忽略。
  }
}

export async function clearLocalSave(): Promise<void> {
  try {
    await getPlatform().setStorage(STORAGE_KEY, null);
  } catch {
    // ignore
  }
}

export function localSaveKey(): string {
  return STORAGE_KEY;
}
