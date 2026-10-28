/** 测试夹具：读取真实 JSON 数据文件（只有测试/工具层可以碰 fs）。 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_DIR = new URL('../src/config/data/', import.meta.url);

function readDataFile(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, DATA_DIR)), 'utf8')) as unknown;
}

export function loadConfigFixture(): Record<string, unknown> {
  const content = readDataFile('content.json');
  const contentVersion =
    typeof content === 'object' &&
    content !== null &&
    typeof (content as { contentVersion?: unknown }).contentVersion === 'string'
      ? (content as { contentVersion: string }).contentVersion
      : '';

  return {
    contentVersion,
    species: readDataFile('species.json'),
    elements: readDataFile('elements.json'),
    affinity: readDataFile('affinity.json'),
    skills: readDataFile('skills.json'),
    passives: readDataFile('passives.json'),
    traits: readDataFile('traits.json'),
    habitats: readDataFile('habitats.json'),
    foods: readDataFile('foods.json'),
    breeding: readDataFile('breeding.json'),
    stages: readDataFile('stages.json'),
    economy: readDataFile('economy.json'),
  };
}

/** 深拷贝，供“改坏一处”的负向用例使用。 */
export function cloneFixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadConfigFixture())) as Record<string, unknown>;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return value as Record<string, unknown>[];
}
