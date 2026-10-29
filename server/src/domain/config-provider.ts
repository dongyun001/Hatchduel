/**
 * 配置仓库加载：D 只维护 JSON（`packages/core/src/config/data/`），A 的 `createConfigRepo` 负责校验与索引。
 *
 * 为什么服务端不在启动时硬失败：M1 早期 `createConfigRepo` 还是契约桩（抛 `CoreNotImplementedError`），
 * 硬失败会让登录/存档这些与配置无关的接口也起不来。这里降级为“无配置仓库”，
 * 领域计算随之降级为恒等推进（见 `core-adapter.ts`）；A 实现后无需改服务端代码。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createConfigRepo } from '@petbattle/core';
import type { ConfigData, ConfigRepo } from '@petbattle/core';

import type { Logger } from '../logger.js';

/** 默认指向仓库内 D 的数据目录；产物构建/镜像可通过环境变量覆盖。 */
const DEFAULT_CONFIG_DIR = new URL('../../../packages/core/src/config/data/', import.meta.url);

const FILES = {
  content: 'content.json',
  species: 'species.json',
  elements: 'elements.json',
  affinity: 'affinity.json',
  skills: 'skills.json',
  passives: 'passives.json',
  traits: 'traits.json',
  habitats: 'habitats.json',
  foods: 'foods.json',
  breeding: 'breeding.json',
  stages: 'stages.json',
  economy: 'economy.json',
} as const;

export type ConfigDirSource = string | URL;

export function resolveConfigDir(source?: string): URL {
  if (source === undefined || source === '') return DEFAULT_CONFIG_DIR;
  const url = new URL(source);
  return url.pathname.endsWith('/') ? url : new URL(`${url.pathname}/`, url);
}

async function readJson(dir: URL, name: string): Promise<unknown> {
  const text = await readFile(new URL(name, dir), 'utf8');
  return JSON.parse(text) as unknown;
}

/** 读全部配置 JSON 并拼成 `ConfigData`；结构校验交给 `createConfigRepo`，这里只做形状断言。 */
export async function readConfigData(dir: URL): Promise<ConfigData> {
  const [content, species, elements, affinity, skills, passives, traits, habitats, foods, breeding, stages, economy] =
    await Promise.all(Object.values(FILES).map((name) => readJson(dir, name)));

  const contentVersion = (content as { contentVersion?: unknown }).contentVersion;
  if (typeof contentVersion !== 'string' || contentVersion === '') {
    throw new Error(`content.json 缺少 contentVersion（目录：${fileURLToPath(dir)}）`);
  }

  return {
    contentVersion,
    species: species as ConfigData['species'],
    elements: elements as ConfigData['elements'],
    affinity: affinity as ConfigData['affinity'],
    skills: skills as ConfigData['skills'],
    passives: passives as ConfigData['passives'],
    traits: traits as ConfigData['traits'],
    habitats: habitats as ConfigData['habitats'],
    foods: foods as ConfigData['foods'],
    breeding: breeding as ConfigData['breeding'],
    stages: stages as ConfigData['stages'],
    economy: economy as ConfigData['economy'],
  };
}

export interface LoadConfigOptions {
  /** 目录覆盖（`PETBATTLE_CONFIG_DIR`）；默认仓库内路径。 */
  configDir?: string;
  logger: Logger;
}

/** 尽力加载配置仓库；失败只告警，返回 undefined 由调用方决定降级策略。 */
export async function loadConfigRepo(options: LoadConfigOptions): Promise<ConfigRepo | undefined> {
  try {
    const data = await readConfigData(resolveConfigDir(options.configDir));
    return createConfigRepo(data);
  } catch (error) {
    options.logger.warn('配置仓库不可用，领域计算将降级为恒等推进', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
