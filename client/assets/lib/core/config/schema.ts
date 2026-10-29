// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * 配置校验（TECH_DESIGN §8.2）。纯函数，不读文件；`tools/src/validate-config.ts` 负责读 JSON。
 *
 * 校验项：
 * 1. 结构：字段类型、范围（cost 0~100、基因 0~100、chance 0~1 等）；
 * 2. 引用：species / element / skill / passive / trait / habitat / food / stage 必须存在；
 * 3. 语义：无自克制、无双向克制、相性只存非 0、关卡只用 MVP 5 物种、passiveId 不悬空。
 */
import { MAX_LEVEL, MVP_ELEMENT_IDS, MVP_SPECIES_IDS } from '../constants';
import type { ConfigData } from './types';

export type ConfigIssueCode =
  | 'not_object'
  | 'missing_field'
  | 'invalid_type'
  | 'invalid_value'
  | 'out_of_range'
  | 'duplicate_id'
  | 'unknown_reference'
  | 'self_counter'
  | 'mutual_counter'
  | 'invalid_affinity'
  | 'stage_species_not_mvp'
  | 'level_sequence'
  | 'invalid_reward';

export interface ConfigIssue {
  path: string;
  code: ConfigIssueCode;
  message: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  issues: ConfigIssue[];
}

export class ConfigValidationError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(`配置校验失败（${issues.length} 项）：${issues[0]?.message ?? ''}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// 基础读取工具
// ---------------------------------------------------------------------------

const RARITIES = ['common', 'rare', 'epic'] as const;
const GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
const STAT_KEYS = ['hp', 'atk', 'def', 'spd', 'crit', 'critDmg', 'hit', 'dodge'] as const;
const CORE_STATS = ['hp', 'atk', 'def', 'spd'] as const;
const SKILL_KINDS = ['normal', 'active'] as const;
const SKILL_TARGETS = ['single', 'all', 'self', 'ally', 'allyAll'] as const;
const EFFECT_KINDS = [
  'damage',
  'heal',
  'shield',
  'buff',
  'debuff',
  'stun',
  'silence',
  'slow',
  'dot',
  'cleanse',
] as const;
const EFFECT_STATS = ['atk', 'def', 'spd'] as const;
const EFFECT_TARGETS = ['self', 'enemy', 'ally', 'allEnemies', 'allAllies'] as const;
const RESOURCE_IDS = ['coin', 'food', 'geneDust', 'premium'] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

class Collector {
  readonly issues: ConfigIssue[] = [];

  add(path: string, code: ConfigIssueCode, message: string): void {
    this.issues.push({ path, code, message });
  }
}

function readString(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): string | undefined {
  const value = rec[key];
  if (!isNonEmptyString(value)) {
    c.add(join(path, key), 'missing_field', `需要非空字符串 "${key}"`);
    return undefined;
  }
  return value;
}

function readOptionalString(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): string | undefined {
  const value = rec[key];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    c.add(join(path, key), 'invalid_type', `"${key}" 需要非空字符串`);
    return undefined;
  }
  return value;
}

function readNumber(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number | undefined {
  const value = rec[key];
  if (!isFiniteNumber(value)) {
    c.add(join(path, key), 'invalid_type', `"${key}" 需要有限数字`);
    return undefined;
  }
  if (value < min || value > max) {
    c.add(join(path, key), 'out_of_range', `"${key}" 需要在 ${min}~${max} 之间，实际 ${value}`);
    return undefined;
  }
  return value;
}

function readOptionalNumber(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number | undefined {
  if (rec[key] === undefined) return undefined;
  return readNumber(c, rec, key, path, min, max);
}

function readInt(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
): number | undefined {
  const value = readNumber(c, rec, key, path, min, max);
  if (value !== undefined && !Number.isInteger(value)) {
    c.add(join(path, key), 'invalid_value', `"${key}" 需要整数`);
    return undefined;
  }
  return value;
}

function readBoolean(c: Collector, rec: UnknownRecord, key: string, path: string): boolean {
  const value = rec[key];
  if (typeof value !== 'boolean') {
    c.add(join(path, key), 'invalid_type', `"${key}" 需要布尔值`);
    return false;
  }
  return value;
}

function readEnum<T extends string>(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const value = rec[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    c.add(join(path, key), 'invalid_value', `"${key}" 必须是 ${allowed.join(' / ')} 之一`);
    return undefined;
  }
  return value as T;
}

function readArray(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): unknown[] | undefined {
  const value = rec[key];
  if (!Array.isArray(value)) {
    c.add(join(path, key), 'invalid_type', `"${key}" 需要数组`);
    return undefined;
  }
  return value;
}

function eachRecord(
  c: Collector,
  list: unknown[] | undefined,
  path: string,
  fn: (item: UnknownRecord, itemPath: string) => void,
): void {
  if (!list) return;
  list.forEach((item, index) => {
    const itemPath = join(path, index);
    if (!isRecord(item)) {
      c.add(itemPath, 'invalid_type', '数组元素需要对象');
      return;
    }
    fn(item, itemPath);
  });
}

function validateStringArray(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): string[] | undefined {
  const list = readArray(c, rec, key, path);
  if (!list) return undefined;
  const out: string[] = [];
  list.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      c.add(join(join(path, key), index), 'invalid_type', '需要非空字符串');
      return;
    }
    out.push(item);
  });
  return out;
}

function validateElementArray(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): void {
  const list = readArray(c, rec, key, path);
  if (!list) return;
  list.forEach((item, index) => {
    if (typeof item !== 'string' || !MVP_ELEMENT_IDS.includes(item as never)) {
      c.add(join(join(path, key), index), 'invalid_value', `属性必须是 ${MVP_ELEMENT_IDS.join(' / ')}`);
    }
  });
}

function validateResourceBag(
  c: Collector,
  value: unknown,
  path: string,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    c.add(path, 'invalid_type', '资源包需要对象');
    return;
  }
  for (const [key, amount] of Object.entries(value)) {
    if (!RESOURCE_IDS.includes(key as never)) {
      c.add(join(path, key), 'invalid_value', `未知资源 id "${key}"`);
      continue;
    }
    if (!isFiniteNumber(amount) || amount < 0 || !Number.isInteger(amount)) {
      c.add(join(path, key), 'invalid_value', '资源数量需要非负整数');
    }
  }
}

function validateCostList(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): void {
  const list = readArray(c, rec, key, path);
  if (!list) return;
  eachRecord(c, list, join(path, key), (item, itemPath) => {
    const resource = readEnum(c, item, 'resource', itemPath, RESOURCE_IDS);
    void resource;
    readInt(c, item, 'amount', itemPath, 0);
  });
}

function validateRateList(
  c: Collector,
  rec: UnknownRecord,
  key: string,
  path: string,
): void {
  const list = readArray(c, rec, key, path);
  if (!list) return;
  eachRecord(c, list, join(path, key), (item, itemPath) => {
    readEnum(c, item, 'resource', itemPath, RESOURCE_IDS);
    readNumber(c, item, 'amountPerHour', itemPath, 0);
  });
}

function validateStatBlock(c: Collector, value: unknown, path: string): void {
  if (!isRecord(value)) {
    c.add(path, 'not_object', '基础属性需要对象');
    return;
  }
  for (const key of ['hp', 'atk', 'def', 'spd'] as const) {
    const v = value[key];
    if (!isFiniteNumber(v) || v <= 0) {
      c.add(join(path, key), 'out_of_range', `"${key}" 需要大于 0`);
    }
  }
  const crit = value['crit'];
  if (!isFiniteNumber(crit) || crit < 0 || crit > 1) {
    c.add(join(path, 'crit'), 'out_of_range', '"crit" 需要在 0~1');
  }
  const critDmg = value['critDmg'];
  if (!isFiniteNumber(critDmg) || critDmg < 0.5 || critDmg > 5) {
    c.add(join(path, 'critDmg'), 'out_of_range', '"critDmg" 需要在 0.5~5');
  }
  const hit = value['hit'];
  if (!isFiniteNumber(hit) || hit < -0.5 || hit > 0.5) {
    c.add(join(path, 'hit'), 'out_of_range', '"hit" 需要在 -0.5~0.5');
  }
  const dodge = value['dodge'];
  if (!isFiniteNumber(dodge) || dodge < 0 || dodge > 0.9) {
    c.add(join(path, 'dodge'), 'out_of_range', '"dodge" 需要在 0~0.9');
  }
}

function validateStatMods(c: Collector, value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    c.add(path, 'invalid_type', 'statMods 需要对象');
    return;
  }
  for (const [key, mod] of Object.entries(value)) {
    if (!STAT_KEYS.includes(key as never)) {
      c.add(join(path, key), 'invalid_value', `未知属性 "${key}"`);
      continue;
    }
    if (!isFiniteNumber(mod) || mod <= 0) {
      c.add(join(path, key), 'out_of_range', '修正倍率需要大于 0');
    }
  }
}

function validateEffects(
  c: Collector,
  value: unknown,
  path: string,
  requireTarget: boolean,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    c.add(path, 'invalid_type', 'effects 需要数组');
    return;
  }
  eachRecord(c, value, path, (effect, effectPath) => {
    readEnum(c, effect, 'kind', effectPath, EFFECT_KINDS);
    readNumber(c, effect, 'value', effectPath);
    readInt(c, effect, 'duration', effectPath, 0);
    readNumber(c, effect, 'chance', effectPath, 0, 1);
    if (effect['stat'] !== undefined) {
      readEnum(c, effect, 'stat', effectPath, EFFECT_STATS);
    }
    if (requireTarget || effect['target'] !== undefined) {
      readEnum(c, effect, 'target', effectPath, EFFECT_TARGETS);
    }
  });
}

// ---------------------------------------------------------------------------
// 各表校验
// ---------------------------------------------------------------------------

interface SpeciesMeta {
  path: string;
  id: string;
  signatureSkillId?: string;
  passiveId?: string;
  counters: string[];
}

function validateSpecies(c: Collector, value: unknown, ids: Set<string>): SpeciesMeta[] {
  const metas: SpeciesMeta[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    c.add('species', 'invalid_type', 'species 需要非空数组');
    return metas;
  }
  eachRecord(c, value, 'species', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `物种 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);

    const grade = item['grade'];
    if (!isRecord(grade)) {
      c.add(join(p, 'grade'), 'not_object', 'grade 需要对象');
    } else {
      for (const key of CORE_STATS) readEnum(c, grade, key, join(p, 'grade'), GRADES);
    }

    validateStatBlock(c, item['base'], join(p, 'base'));

    const growth = item['growth'];
    if (!isRecord(growth)) {
      c.add(join(p, 'growth'), 'not_object', 'growth 需要对象');
    } else {
      for (const key of CORE_STATS) readNumber(c, growth, key, join(p, 'growth'), 0, 1);
    }

    const signatureSkillId = readString(c, item, 'signatureSkillId', p);
    const passiveId = readOptionalString(c, item, 'passiveId', p);
    const counters = validateStringArray(c, item, 'counters', p) ?? [];

    counters.forEach((target, index) => {
      if (id && target === id) {
        c.add(
          join(join(p, 'counters'), index),
          'self_counter',
          `物种 ${id} 不能克制自己`,
        );
      }
    });

    validateElementArray(c, item, 'habitatTags', p);
    readEnum(c, item, 'rarity', p, RARITIES);
    readBoolean(c, item, 'breedable', p);
    readString(c, item, 'spriteId', p);

    metas.push({ path: p, id: id ?? '', signatureSkillId, passiveId, counters });
  });
  return metas;
}

interface ElementMeta {
  path: string;
  id: string;
  skillPool: string[];
}

function validateElements(c: Collector, value: unknown, ids: Set<string>): ElementMeta[] {
  const metas: ElementMeta[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    c.add('elements', 'invalid_type', 'elements 需要非空数组');
    return metas;
  }
  eachRecord(c, value, 'elements', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (!MVP_ELEMENT_IDS.includes(id as never)) {
        c.add(join(p, 'id'), 'invalid_value', `未知属性 id "${id}"`);
      }
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `属性 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    const pool = validateStringArray(c, item, 'skillPool', p) ?? [];
    if (Array.isArray(item['skillPool']) && item['skillPool'].length !== 2) {
      c.add(join(p, 'skillPool'), 'invalid_value', 'skillPool 需要恰好 2 个技能');
    }
    readString(c, item, 'color', p);
    readEnum(c, item, 'habitatTag', p, MVP_ELEMENT_IDS);
    metas.push({ path: p, id: id ?? '', skillPool: pool });
  });
  return metas;
}

function validateSkills(
  c: Collector,
  value: unknown,
  ids: Set<string>,
  kinds: Map<string, string>,
): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('skills', 'invalid_type', 'skills 需要非空数组');
    return;
  }
  eachRecord(c, value, 'skills', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `技能 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    const kind = readEnum(c, item, 'kind', p, SKILL_KINDS);
    if (id && kind) kinds.set(id, kind);
    const cost = readInt(c, item, 'cost', p, 0, 100);
    if (kind === 'normal' && cost !== undefined && cost !== 0) {
      c.add(join(p, 'cost'), 'invalid_value', '普攻 cost 必须为 0');
    }
    readEnum(c, item, 'target', p, SKILL_TARGETS);
    readNumber(c, item, 'power', p, 0);
    validateEffects(c, item['effects'], join(p, 'effects'), false);
    readOptionalNumber(c, item, 'cooldown', p, 0);
  });
}

function validatePassives(c: Collector, value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('passives', 'invalid_type', 'passives 需要非空数组');
    return;
  }
  eachRecord(c, value, 'passives', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `被动 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    readString(c, item, 'description', p);
    validateStatMods(c, item['statMods'], join(p, 'statMods'));
    validateEffects(c, item['effects'], join(p, 'effects'), true);
  });
}

function validateTraits(c: Collector, value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('traits', 'invalid_type', 'traits 需要非空数组');
    return;
  }
  eachRecord(c, value, 'traits', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `特质 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    readString(c, item, 'description', p);
    readEnum(c, item, 'rarity', p, RARITIES);
    validateStatMods(c, item['statMods'], join(p, 'statMods'));
    readOptionalNumber(c, item, 'productionMod', p, 0.0001);
    const tags = item['battleTags'];
    if (tags !== undefined) validateStringArray(c, item, 'battleTags', p);

    const inheritance = item['inheritance'];
    if (!isRecord(inheritance)) {
      c.add(join(p, 'inheritance'), 'not_object', 'inheritance 需要对象');
    } else {
      readNumber(c, inheritance, 'weight', join(p, 'inheritance'), 0, 1);
    }
  });
}

function validateHabitats(c: Collector, value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('habitats', 'invalid_type', 'habitats 需要非空数组');
    return;
  }
  eachRecord(c, value, 'habitats', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `栖息地 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    readInt(c, item, 'capacity', p, 1);
    readInt(c, item, 'healthDecayWhenStarving', p, 0);
    readInt(c, item, 'healthRecoveryPerHour', p, 0);
    // contract-v1.2 D-05/D-06：可选字段，缺省时按 DOMAIN §6.1 的默认值结算。
    readOptionalNumber(c, item, 'hungerPenaltyWhenNoFoodPerHour', p, 0);
    const stageMul = item['productionStageMul'];
    if (stageMul !== undefined) {
      if (!isRecord(stageMul)) {
        c.add(join(p, 'productionStageMul'), 'invalid_type', 'productionStageMul 需要对象');
      } else {
        for (const key of ['juvenile', 'adult', 'elder'] as const) {
          readNumber(c, stageMul, key, join(p, 'productionStageMul'), 0);
        }
      }
    }
    readInt(c, item, 'offlineCapMs', p, 1);
    readInt(c, item, 'decayCapMs', p, 1);

    const bonus = item['elementBonus'];
    if (!isRecord(bonus)) {
      c.add(join(p, 'elementBonus'), 'not_object', 'elementBonus 需要对象');
    } else {
      for (const [key, mul] of Object.entries(bonus)) {
        if (!MVP_ELEMENT_IDS.includes(key as never)) {
          c.add(join(join(p, 'elementBonus'), key), 'invalid_value', `未知属性 "${key}"`);
        } else if (!isFiniteNumber(mul) || mul < 0) {
          c.add(join(join(p, 'elementBonus'), key), 'out_of_range', '加成需要非负数字');
        }
      }
    }

    validateRateList(c, item, 'productionPerHour', p);
    validateRateList(c, item, 'upkeepPerPetPerHour', p);

    const decay = item['conditionDecayPerHour'];
    if (!isRecord(decay)) {
      c.add(join(p, 'conditionDecayPerHour'), 'not_object', 'conditionDecayPerHour 需要对象');
    } else {
      for (const key of ['hunger', 'mood', 'hygiene'] as const) {
        readNumber(c, decay, key, join(p, 'conditionDecayPerHour'), 0);
      }
    }

    const upgrade = item['upgrade'];
    if (!isRecord(upgrade)) {
      c.add(join(p, 'upgrade'), 'not_object', 'upgrade 需要对象');
      return;
    }
    const maxLevel = readInt(c, upgrade, 'maxLevel', join(p, 'upgrade'), 1);
    const levels = readArray(c, upgrade, 'levels', join(p, 'upgrade'));
    if (!levels) return;
    const levelsPath = join(join(p, 'upgrade'), 'levels');
    if (maxLevel !== undefined && levels.length !== maxLevel) {
      c.add(levelsPath, 'invalid_value', `levels 长度需要等于 maxLevel（${maxLevel}）`);
    }
    eachRecord(c, levels, levelsPath, (level, lp) => {
      const index = Number(lp.slice(lp.lastIndexOf('[') + 1, -1));
      const levelNo = readInt(c, level, 'level', lp, 1);
      if (levelNo !== undefined && levelNo !== index + 1) {
        c.add(join(lp, 'level'), 'level_sequence', `等级需要从 1 连续递增，期望 ${index + 1}`);
      }
      validateCostList(c, level, 'cost', lp);
      readInt(c, level, 'capacity', lp, 1);
      readNumber(c, level, 'productionMul', lp, 0.0001);
    });
  });
}

function validateFoods(c: Collector, value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('foods', 'invalid_type', 'foods 需要非空数组');
    return;
  }
  eachRecord(c, value, 'foods', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `食物 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    validateCostList(c, item, 'cost', p);
    readNumber(c, item, 'nutrition', p, 0);
    readNumber(c, item, 'mood', p, 0);
  });
}

function validateBreeding(c: Collector, value: unknown): void {
  if (!isRecord(value)) {
    c.add('breeding', 'not_object', 'breeding 需要对象');
    return;
  }
  const p = 'breeding';
  readInt(c, value, 'hatchMs', p, 1);
  readInt(c, value, 'juvenileMs', p, 1);
  readInt(c, value, 'elderAfterMs', p, 1);
  readInt(c, value, 'cooldownMs', p, 0);
  validateCostList(c, value, 'cost', p);
  readInt(c, value, 'maxExpressedTraits', p, 1);
  readInt(c, value, 'maxHiddenTraits', p, 0);

  const mutation = value['mutation'];
  if (!isRecord(mutation)) {
    c.add(join(p, 'mutation'), 'not_object', 'mutation 需要对象');
  } else {
    readNumber(c, mutation, 'geneSigma', join(p, 'mutation'), 0);
    readNumber(c, mutation, 'traitChance', join(p, 'mutation'), 0, 1);
    readNumber(c, mutation, 'elementChance', join(p, 'mutation'), 0, 1);
  }

  const inbreeding = value['inbreeding'];
  if (!isRecord(inbreeding)) {
    c.add(join(p, 'inbreeding'), 'not_object', 'inbreeding 需要对象');
  } else {
    readInt(c, inbreeding, 'generations', join(p, 'inbreeding'), 1);
    readNumber(c, inbreeding, 'genePenalty', join(p, 'inbreeding'), 0);
    readNumber(c, inbreeding, 'mutationBonus', join(p, 'inbreeding'), 0, 1);
    readNumber(c, inbreeding, 'fertilityPenalty', join(p, 'inbreeding'), 0, 1);
  }
}

function validateReward(
  c: Collector,
  value: unknown,
  path: string,
  speciesIds: Set<string>,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    c.add(path, 'not_object', '奖励需要对象');
    return;
  }
  validateResourceBag(c, value['resources'], join(path, 'resources'));
  readOptionalNumber(c, value, 'petExp', path, 0);

  for (const key of ['pets', 'eggs'] as const) {
    const list = value[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      c.add(join(path, key), 'invalid_type', `"${key}" 需要数组`);
      continue;
    }
    eachRecord(c, list, join(path, key), (item, ip) => {
      const speciesId = readString(c, item, 'speciesId', ip);
      if (speciesId && !speciesIds.has(speciesId)) {
        c.add(join(ip, 'speciesId'), 'unknown_reference', `未知物种 "${speciesId}"`);
      }
      readEnum(c, item, 'elementId', ip, MVP_ELEMENT_IDS);
      if (item['gender'] !== undefined) readEnum(c, item, 'gender', ip, ['male', 'female']);
    });
  }
}

function validateStages(
  c: Collector,
  value: unknown,
  speciesIds: Set<string>,
  traitIds: Set<string>,
): void {
  if (!Array.isArray(value) || value.length === 0) {
    c.add('stages', 'invalid_type', 'stages 需要非空数组');
    return;
  }
  const ids = new Set<string>();
  const orders = new Set<number>();
  eachRecord(c, value, 'stages', (item, p) => {
    const id = readString(c, item, 'id', p);
    if (id) {
      if (ids.has(id)) c.add(join(p, 'id'), 'duplicate_id', `关卡 id 重复：${id}`);
      ids.add(id);
    }
    readString(c, item, 'name', p);
    const order = readInt(c, item, 'order', p, 1);
    if (order !== undefined) {
      if (orders.has(order)) c.add(join(p, 'order'), 'duplicate_id', `关卡序号重复：${order}`);
      orders.add(order);
    }

    const enemies = readArray(c, item, 'enemies', p);
    if (enemies && enemies.length === 0) {
      c.add(join(p, 'enemies'), 'invalid_value', '关卡至少需要 1 个敌人');
    }
    eachRecord(c, enemies, join(p, 'enemies'), (enemy, ep) => {
      const speciesId = readString(c, enemy, 'speciesId', ep);
      if (speciesId) {
        if (!speciesIds.has(speciesId)) {
          c.add(join(ep, 'speciesId'), 'unknown_reference', `未知物种 "${speciesId}"`);
        } else if (!MVP_SPECIES_IDS.includes(speciesId as never)) {
          c.add(
            join(ep, 'speciesId'),
            'stage_species_not_mvp',
            `MVP 关卡只允许 ${MVP_SPECIES_IDS.join(' / ')}，实际 "${speciesId}"`,
          );
        }
      }
      readEnum(c, enemy, 'elementId', ep, MVP_ELEMENT_IDS);
      readInt(c, enemy, 'level', ep, 1, MAX_LEVEL);
      readNumber(c, enemy, 'geneQuality', ep, 0, 100);
      const traits = validateStringArray(c, enemy, 'traits', ep) ?? [];
      traits.forEach((traitId, index) => {
        if (!traitIds.has(traitId)) {
          c.add(join(join(ep, 'traits'), index), 'unknown_reference', `未知特质 "${traitId}"`);
        }
      });
    });

    const rewards = item['rewards'];
    if (!isRecord(rewards)) {
      c.add(join(p, 'rewards'), 'not_object', 'rewards 需要对象');
    } else {
      validateReward(c, rewards['firstClear'], join(join(p, 'rewards'), 'firstClear'), speciesIds);
      validateReward(c, rewards['repeat'], join(join(p, 'rewards'), 'repeat'), speciesIds);
    }
  });
}

function validateAffinity(
  c: Collector,
  value: unknown,
  speciesIds: Set<string>,
  elementIds: Set<string>,
): void {
  if (!isRecord(value)) {
    c.add('affinity', 'not_object', 'affinity 需要对象');
    return;
  }
  for (const [elementId, row] of Object.entries(value)) {
    const rowPath = join('affinity', elementId);
    if (!elementIds.has(elementId)) {
      c.add(rowPath, 'unknown_reference', `未知属性 "${elementId}"`);
      continue;
    }
    if (!isRecord(row)) {
      c.add(rowPath, 'invalid_type', '相性行需要对象');
      continue;
    }
    for (const [speciesId, affinity] of Object.entries(row)) {
      const cellPath = join(rowPath, speciesId);
      if (!speciesIds.has(speciesId)) {
        c.add(cellPath, 'unknown_reference', `未知物种 "${speciesId}"`);
        continue;
      }
      if (affinity === 0) {
        c.add(cellPath, 'invalid_affinity', '相性只存非 0 项（缺省即 0）');
      } else if (affinity !== 1 && affinity !== -1) {
        c.add(cellPath, 'invalid_affinity', '相性只能是 1 / -1，或省略表示 0');
      }
    }
  }
}

function validateEconomy(c: Collector, value: unknown): void {
  if (!isRecord(value)) {
    c.add('economy', 'not_object', 'economy 需要对象');
    return;
  }
  validateResourceBag(c, value['startingResources'], 'economy.startingResources');

  const refund = value['releaseRefund'];
  if (!isRecord(refund)) {
    c.add('economy.releaseRefund', 'not_object', 'releaseRefund 需要对象');
  } else {
    readNumber(c, refund, 'base', 'economy.releaseRefund', 0);
    readNumber(c, refund, 'perLevel', 'economy.releaseRefund', 0);
    readNumber(c, refund, 'perGeneSumDivisor', 'economy.releaseRefund', 0.0001);
    const bonus = refund['rarityBonus'];
    if (!isRecord(bonus)) {
      c.add('economy.releaseRefund.rarityBonus', 'not_object', 'rarityBonus 需要对象');
    } else {
      for (const key of RARITIES) {
        readNumber(c, bonus, key, 'economy.releaseRefund.rarityBonus', 0);
      }
    }
  }

  const caps = value['resourceCaps'];
  if (caps !== undefined) {
    if (!isRecord(caps)) {
      c.add('economy.resourceCaps', 'invalid_type', 'resourceCaps 需要对象');
    } else {
      for (const [key, cap] of Object.entries(caps)) {
        if (!RESOURCE_IDS.includes(key as never)) {
          c.add(join('economy.resourceCaps', key), 'invalid_value', `未知资源 "${key}"`);
        } else if (!isFiniteNumber(cap) || cap < 0) {
          c.add(join('economy.resourceCaps', key), 'out_of_range', '上限需要非负数字');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 交叉引用
// ---------------------------------------------------------------------------

function validateReferences(
  c: Collector,
  species: SpeciesMeta[],
  elements: ElementMeta[],
  skillIds: Set<string>,
  skillKinds: Map<string, string>,
  passiveIds: Set<string>,
  speciesIds: Set<string>,
): void {
  for (const meta of species) {
    if (!meta.id) continue;
    if (meta.signatureSkillId) {
      if (!skillIds.has(meta.signatureSkillId)) {
        c.add(
          join(meta.path, 'signatureSkillId'),
          'unknown_reference',
          `未知技能 "${meta.signatureSkillId}"`,
        );
      } else if (skillKinds.get(meta.signatureSkillId) !== 'active') {
        c.add(join(meta.path, 'signatureSkillId'), 'invalid_value', '物种技能必须是 active');
      }
    }
    if (meta.passiveId && !passiveIds.has(meta.passiveId)) {
      c.add(
        join(meta.path, 'passiveId'),
        'unknown_reference',
        `未知被动 "${meta.passiveId}"（PITFALLS P-032）`,
      );
    }
    meta.counters.forEach((target, index) => {
      if (!speciesIds.has(target)) {
        c.add(
          join(join(meta.path, 'counters'), index),
          'unknown_reference',
          `未知物种 "${target}"`,
        );
      }
    });
  }

  for (const element of elements) {
    element.skillPool.forEach((skillId, index) => {
      if (!skillIds.has(skillId)) {
        c.add(
          join(join(element.path, 'skillPool'), index),
          'unknown_reference',
          `未知技能 "${skillId}"`,
        );
      } else if (skillKinds.get(skillId) !== 'active') {
        c.add(join(join(element.path, 'skillPool'), index), 'invalid_value', '属性技能必须是 active');
      }
    });
  }

  // 双向克制：MVP 只允许单向网。
  for (const a of species) {
    for (const b of species) {
      if (a.id === b.id || !a.id || !b.id) continue;
      if (a.counters.includes(b.id) && b.counters.includes(a.id)) {
        c.add(join(a.path, 'counters'), 'mutual_counter', `物种 ${a.id} 与 ${b.id} 双向克制`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function validateConfig(input: unknown): ConfigValidationResult {
  const c = new Collector();

  if (!isRecord(input)) {
    c.add('', 'not_object', '配置根节点需要对象');
    return { ok: false, issues: c.issues };
  }

  readString(c, input, 'contentVersion', '');

  const speciesIds = new Set<string>();
  const elementIds = new Set<string>();
  const skillIds = new Set<string>();
  const skillKinds = new Map<string, string>();
  const passiveIds = new Set<string>();
  const traitIds = new Set<string>();
  const habitatIds = new Set<string>();
  const foodIds = new Set<string>();

  const species = validateSpecies(c, input['species'], speciesIds);
  const elements = validateElements(c, input['elements'], elementIds);
  validateSkills(c, input['skills'], skillIds, skillKinds);
  validatePassives(c, input['passives'], passiveIds);
  validateTraits(c, input['traits'], traitIds);
  validateHabitats(c, input['habitats'], habitatIds);
  validateFoods(c, input['foods'], foodIds);
  validateBreeding(c, input['breeding']);
  validateStages(c, input['stages'], speciesIds, traitIds);
  validateEconomy(c, input['economy']);
  validateAffinity(c, input['affinity'], speciesIds, elementIds);

  validateReferences(c, species, elements, skillIds, skillKinds, passiveIds, speciesIds);

  return { ok: c.issues.length === 0, issues: c.issues };
}

/** 校验通过返回原对象（窄化为 `ConfigData`），否则抛 `ConfigValidationError`。 */
export function assertConfig(input: unknown): ConfigData {
  const result = validateConfig(input);
  if (!result.ok) throw new ConfigValidationError(result.issues);
  return input as ConfigData;
}
