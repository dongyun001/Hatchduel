/**
 * 从磁盘加载 `packages/core/src/config/data/*.json` 并组装 `ConfigData`。
 *
 * 只有工具/模拟层可以读文件；`@petbattle/core` 本身不碰 fs。
 * 组装后立即 `assertConfig`，保证 sim 用的是与 `validate:config` 同一套规则。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertConfig, type ConfigData } from '@petbattle/core';

const DATA_DIR = new URL('../../core/src/config/data/', import.meta.url);

function readJson(file: string): unknown {
  const url = new URL(file, DATA_DIR);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as unknown;
}

function readContentVersion(): string {
  const content = readJson('content.json');
  if (
    typeof content === 'object' &&
    content !== null &&
    typeof (content as { contentVersion?: unknown }).contentVersion === 'string'
  ) {
    return (content as { contentVersion: string }).contentVersion;
  }
  return '';
}

export function loadConfig(): ConfigData {
  return assertConfig({
    contentVersion: readContentVersion(),
    species: readJson('species.json'),
    elements: readJson('elements.json'),
    affinity: readJson('affinity.json'),
    skills: readJson('skills.json'),
    passives: readJson('passives.json'),
    traits: readJson('traits.json'),
    habitats: readJson('habitats.json'),
    foods: readJson('foods.json'),
    breeding: readJson('breeding.json'),
    stages: readJson('stages.json'),
    economy: readJson('economy.json'),
  });
}
