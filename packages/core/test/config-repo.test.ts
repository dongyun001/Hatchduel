import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  createConfigRepo,
  type ConfigData,
} from '@petbattle/core';

import { asRecord, asRecordArray, cloneFixture, loadConfigFixture } from './fixtures.js';
import { makePet, makeRepo } from './factory.js';

function fixtureData(): ConfigData {
  return loadConfigFixture() as unknown as ConfigData;
}

describe('createConfigRepo（DOMAIN §2.8，C-04）', () => {
  it('加载样例配置并暴露 contentVersion 与全部索引', () => {
    const fixture = fixtureData();
    const repo = createConfigRepo(fixture);
    // 不写死版本号：contentVersion 随 D 的内容变更递增（CONTRACT §6.2）。
    expect(repo.contentVersion).toBe(fixture.contentVersion);
    expect(repo.species('turtle').name).toBe('龟');
    expect(repo.element('fire').name).toBe('火');
    expect(repo.skill('normal_strike').kind).toBe('normal');
    expect(repo.passive('passive_turtle_shell').statMods).toEqual({ def: 1.08 });
    expect(repo.trait('trait_sturdy').rarity).toBe('common');
    expect(repo.habitat('meadow').capacity).toBe(4);
    expect(repo.food('berry').nutrition).toBe(25);
    expect(repo.stage('stage_1').order).toBe(1);
    expect(repo.breeding().hatchMs).toBe(1_800_000);
    expect(repo.economy().releaseRefund.perGeneSumDivisor).toBe(10);
  });

  it('all*() 返回冻结的只读副本', () => {
    const repo = createConfigRepo(fixtureData());
    for (const list of [
      repo.allSpecies(),
      repo.allElements(),
      repo.allSkills(),
      repo.allPassives(),
      repo.allTraits(),
      repo.allHabitats(),
      repo.allFoods(),
      repo.allStages(),
    ]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
    expect(repo.allSpecies()).toHaveLength(5);
    expect(repo.allSkills()).toHaveLength(16);
  });

  it('配置不合法时抛 ConfigValidationError，不做部分加载', () => {
    const broken = cloneFixture();
    asRecordArray(broken['species'])[0]!['passiveId'] = 'passive_missing';
    expect(() => createConfigRepo(broken as unknown as ConfigData)).toThrow(ConfigValidationError);
    expect(() => createConfigRepo(null as never)).toThrow(ConfigValidationError);
  });

  it('缺少 id 时抛带明确信息的错误', () => {
    const repo = createConfigRepo(fixtureData());
    expect(() => repo.species('dragon')).toThrow(/species.*dragon/);
    expect(() => repo.element('light' as never)).toThrow(/elements.*light/);
    expect(() => repo.skill('nope')).toThrow(/skills.*nope/);
    expect(() => repo.passive('nope')).toThrow(/passives.*nope/);
    expect(() => repo.trait('nope')).toThrow(/traits.*nope/);
    expect(() => repo.habitat('nope')).toThrow(/habitats.*nope/);
    expect(() => repo.food('nope')).toThrow(/foods.*nope/);
    expect(() => repo.stage('nope')).toThrow(/stages.*nope/);
  });

  it('重复 id 在构造期被拒绝（绕过 validateConfig 的重复检查不可能）', () => {
    const duplicated = cloneFixture();
    const species = asRecordArray(duplicated['species']);
    species.push({ ...species[0]! });
    expect(() => createConfigRepo(duplicated as unknown as ConfigData)).toThrow(ConfigValidationError);
  });
});

describe('ConfigRepo：相性与克制（DOMAIN §2.4/§2.8）', () => {
  const repo = makeRepo();

  it('affinity 缺省为 0，命中 ±1', () => {
    expect(repo.affinity('water', 'turtle')).toBe(1);
    expect(repo.affinity('fire', 'fish')).toBe(-1);
    expect(repo.affinity('water', 'fish')).toBe(0);
    expect(repo.affinity('grass', 'snake')).toBe(1);
  });

  it('counterMultiplier：攻方克制 1.25 / 被克制 0.85 / 无关系 1', () => {
    expect(repo.counterMultiplier('turtle', 'fish')).toBe(1.25);
    expect(repo.counterMultiplier('fish', 'turtle')).toBe(0.85);
    expect(repo.counterMultiplier('frog', 'frog')).toBe(1);
    expect(repo.counterMultiplier('cat', 'snake')).toBe(1.25);
    expect(repo.counterMultiplier('snake', 'cat')).toBe(0.85);
  });
});

describe('ConfigRepo：技能与特质', () => {
  const repo = makeRepo();

  it('skillsFor 返回 [普攻, 属性小技能, 属性大招, 物种技能]', () => {
    const pet = makePet({ speciesId: 'fish', elementId: 'water' });
    expect(repo.skillsFor(pet)).toEqual([
      'normal_strike',
      'water_wave',
      'water_torrent',
      'fish_tide',
    ]);
    const thunderCat = makePet({ speciesId: 'cat', elementId: 'thunder' });
    expect(repo.skillsFor(thunderCat)).toEqual([
      'normal_strike',
      'thunder_spark',
      'thunder_storm',
      'cat_pounce',
    ]);
  });

  it('traitsFor 映射配置并忽略已删除的特质', () => {
    const pet = makePet({ traits: ['trait_sturdy', 'trait_removed'] });
    const traits = repo.traitsFor(pet);
    expect(traits).toHaveLength(1);
    expect(traits[0]!.id).toBe('trait_sturdy');
  });
});

describe('ConfigRepo：工具函数', () => {
  it('缺少普攻技能时构造失败', () => {
    const config = cloneFixture();
    const skills = asRecordArray(config['skills']);
    const normal = skills.find((item) => item['id'] === 'normal_strike')!;
    normal['kind'] = 'active';
    normal['cost'] = 40;
    // 配置里不再有 kind=normal 的技能；校验仍会通过（只校验普攻 cost=0 的情况），
    // 由 repo 构造时报出明确错误。
    expect(() => createConfigRepo(config as unknown as ConfigData)).toThrow(/普攻/);
  });

  it('breeding/economy 返回配置原文', () => {
    const fixture = fixtureData();
    const repo = createConfigRepo(fixture);
    expect(repo.breeding().inbreeding.generations).toBe(3);
    // 初始资源由 D 调参，测试对照 fixture，不写死数值。
    expect(repo.economy().startingResources).toEqual(fixture.economy.startingResources);
  });

  it('对同一份数据重复构造结果一致', () => {
    const first = createConfigRepo(fixtureData());
    const second = createConfigRepo(fixtureData());
    expect(first.allSkills().map((s) => s.id)).toEqual(second.allSkills().map((s) => s.id));
  });

  it('配置对象本身不被修改', () => {
    const data = fixtureData();
    const before = JSON.stringify(data);
    createConfigRepo(data);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('栖息地元素加成只来自配置', () => {
    const config = cloneFixture();
    asRecord(asRecordArray(config['habitats'])[0]!['elementBonus'])['water'] = 0.5;
    const repo = createConfigRepo(config as unknown as ConfigData);
    expect(repo.habitat('meadow').elementBonus['water']).toBe(0.5);
  });
});
