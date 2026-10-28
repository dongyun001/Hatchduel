/**
 * 从磁盘读取 `packages/core/src/config/data/*.json` 并组装 `ConfigData`。
 *
 * 注意：只有工具层可以读文件；`@petbattle/core` 本身不碰 fs。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RawConfigBundle {
  contentVersion: string;
  species: unknown[];
  elements: unknown[];
  affinity: Record<string, unknown>;
  skills: unknown[];
  passives: unknown[];
  traits: unknown[];
  habitats: unknown[];
  foods: unknown[];
  breeding: unknown;
  stages: unknown[];
  economy: unknown;
}

const DATA_DIR = new URL('../../packages/core/src/config/data/', import.meta.url);

function readJson(file: string): unknown {
  const path = fileURLToPath(new URL(file, DATA_DIR));
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadConfigBundle(): RawConfigBundle {
  const content = readJson('content.json');
  const contentVersion =
    typeof content === 'object' &&
    content !== null &&
    typeof (content as { contentVersion?: unknown }).contentVersion === 'string'
      ? (content as { contentVersion: string }).contentVersion
      : '';

  return {
    contentVersion,
    species: readJson('species.json') as unknown[],
    elements: readJson('elements.json') as unknown[],
    affinity: readJson('affinity.json') as Record<string, unknown>,
    skills: readJson('skills.json') as unknown[],
    passives: readJson('passives.json') as unknown[],
    traits: readJson('traits.json') as unknown[],
    habitats: readJson('habitats.json') as unknown[],
    foods: readJson('foods.json') as unknown[],
    breeding: readJson('breeding.json'),
    stages: readJson('stages.json') as unknown[],
    economy: readJson('economy.json'),
  };
}
