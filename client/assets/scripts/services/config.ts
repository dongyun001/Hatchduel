import { JsonAsset, resources } from 'cc';
import { createConfigRepo } from '../../lib/core';
import type { ConfigData, ConfigRepo } from '../../lib/core';

/**
 * 运行时配置加载：assets/resources/config/*.json（由 sync-lib 从 packages/core/src/config/data 复制）。
 * 加载完交给 `createConfigRepo` 校验；失败直接抛错，不做部分降级。
 */
const FILES = [
  'content',
  'species',
  'elements',
  'affinity',
  'skills',
  'passives',
  'traits',
  'habitats',
  'foods',
  'breeding',
  'stages',
  'economy',
] as const;

let cached: ConfigRepo | null = null;

function loadJson(name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resources.load(`config/${name}`, JsonAsset, (error, asset) => {
      if (error || !asset) {
        reject(error ?? new Error(`配置资源缺失：config/${name}`));
        return;
      }
      resolve(asset.json);
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function loadConfigRepo(): Promise<ConfigRepo> {
  if (cached) return cached;

  const [
    content,
    species,
    elements,
    affinity,
    skills,
    passives,
    traits,
    habitats,
    foods,
    breeding,
    stages,
    economy,
  ] = await Promise.all(FILES.map(loadJson));

  const contentRecord = asRecord(content);
  const bundle: ConfigData = {
    contentVersion: typeof contentRecord.contentVersion === 'string' ? contentRecord.contentVersion : '',
    species: asArray<ConfigData['species'][number]>(species),
    elements: asArray<ConfigData['elements'][number]>(elements),
    affinity: affinity as ConfigData['affinity'],
    skills: asArray<ConfigData['skills'][number]>(skills),
    passives: asArray<ConfigData['passives'][number]>(passives),
    traits: asArray<ConfigData['traits'][number]>(traits),
    habitats: asArray<ConfigData['habitats'][number]>(habitats),
    foods: asArray<ConfigData['foods'][number]>(foods),
    breeding: breeding as ConfigData['breeding'],
    stages: asArray<ConfigData['stages'][number]>(stages),
    economy: economy as ConfigData['economy'],
  };

  cached = createConfigRepo(bundle);
  return cached;
}

export function getConfigRepo(): ConfigRepo {
  if (!cached) throw new Error('配置尚未加载：请先从 Boot 启动（loadConfigRepo）');
  return cached;
}

export function hasConfigRepo(): boolean {
  return cached !== null;
}
