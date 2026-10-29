import { describe, expect, it } from 'vitest';

import { validateConfig, type ConfigIssueCode, type ConfigValidationResult } from '@petbattle/core';

import { asRecord, asRecordArray, cloneFixture, loadConfigFixture } from './fixtures.js';

function codes(result: ConfigValidationResult): ConfigIssueCode[] {
  return result.issues.map((issue) => issue.code);
}

describe('validateConfig：样例数据', () => {
  it('仓库内样例配置通过，且覆盖 5 物种 / 16 主动 / 5 被动 / 5 关卡', () => {
    const config = loadConfigFixture();
    const result = validateConfig(config);

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(asRecordArray(config['species'])).toHaveLength(5);
    expect(asRecordArray(config['elements'])).toHaveLength(5);
    expect(asRecordArray(config['skills'])).toHaveLength(16);
    expect(asRecordArray(config['passives'])).toHaveLength(5);
    expect(asRecordArray(config['stages'])).toHaveLength(5);
  });

  it('根节点不是对象时直接失败', () => {
    expect(codes(validateConfig(null))).toContain('not_object');
    expect(codes(validateConfig([]))).toContain('not_object');
    expect(validateConfig('nope').ok).toBe(false);
  });
});

describe('validateConfig：引用完整性', () => {
  it('passiveId 悬空（P-032）', () => {
    const config = cloneFixture();
    asRecordArray(config['species'])[0]!['passiveId'] = 'passive_missing';

    const result = validateConfig(config);
    expect(codes(result)).toContain('unknown_reference');
    expect(result.issues.some((i) => i.path === 'species[0].passiveId')).toBe(true);
  });

  it('species.signatureSkillId 悬空', () => {
    const config = cloneFixture();
    asRecordArray(config['species'])[0]!['signatureSkillId'] = 'skill_missing';

    const result = validateConfig(config);
    expect(codes(result)).toContain('unknown_reference');
  });

  it('element.skillPool 悬空', () => {
    const config = cloneFixture();
    asRecordArray(config['elements'])[0]!['skillPool'] = ['skill_missing', 'water_torrent'];

    const result = validateConfig(config);
    expect(codes(result)).toContain('unknown_reference');
  });

  it('物种 counters 指向不存在的物种', () => {
    const config = cloneFixture();
    asRecordArray(config['species'])[0]!['counters'] = ['dragon'];

    const result = validateConfig(config);
    expect(codes(result)).toContain('unknown_reference');
  });
});

describe('validateConfig：克制与相性语义', () => {
  it('禁止自克制', () => {
    const config = cloneFixture();
    asRecordArray(config['species'])[0]!['counters'] = ['turtle'];

    const result = validateConfig(config);
    expect(codes(result)).toContain('self_counter');
  });

  it('禁止双向克制', () => {
    const config = cloneFixture();
    const species = asRecordArray(config['species']);
    const fish = species.find((item) => item['id'] === 'fish')!;
    fish['counters'] = ['frog', 'turtle'];

    const result = validateConfig(config);
    expect(codes(result)).toContain('mutual_counter');
  });

  it('相性只存非 0 项', () => {
    const config = cloneFixture();
    asRecord(asRecord(config['affinity'])['water'])['turtle'] = 0;

    const result = validateConfig(config);
    expect(codes(result)).toContain('invalid_affinity');
  });

  it('相性值只能是 ±1', () => {
    const config = cloneFixture();
    asRecord(asRecord(config['affinity'])['water'])['turtle'] = 2;

    const result = validateConfig(config);
    expect(codes(result)).toContain('invalid_affinity');
  });
});

describe('validateConfig：关卡与数值范围', () => {
  it('MVP 关卡不得使用后续物种', () => {
    const config = cloneFixture();
    const species = asRecordArray(config['species']);
    const turtle = species[0]!;
    species.push({ ...turtle, id: 'dino', name: '恐龙', spriteId: 'dino' });

    const stages = asRecordArray(config['stages']);
    asRecordArray(stages[0]!['enemies'])[0]!['speciesId'] = 'dino';

    const result = validateConfig(config);
    expect(codes(result)).toContain('stage_species_not_mvp');
  });

  it('技能精力超出 0~100', () => {
    const config = cloneFixture();
    const skills = asRecordArray(config['skills']);
    const wave = skills.find((item) => item['id'] === 'water_wave')!;
    wave['cost'] = 120;

    const result = validateConfig(config);
    expect(codes(result)).toContain('out_of_range');
  });

  it('普攻 cost 必须为 0', () => {
    const config = cloneFixture();
    const skills = asRecordArray(config['skills']);
    const normal = skills.find((item) => item['id'] === 'normal_strike')!;
    normal['cost'] = 10;

    const result = validateConfig(config);
    expect(codes(result)).toContain('invalid_value');
  });

  it('重复物种 id', () => {
    const config = cloneFixture();
    const species = asRecordArray(config['species']);
    species.push({ ...species[0]! });

    const result = validateConfig(config);
    expect(codes(result)).toContain('duplicate_id');
  });

  it('栖息地 upgrade.levels 长度必须等于 maxLevel', () => {
    const config = cloneFixture();
    asRecord(asRecordArray(config['habitats'])[0]!['upgrade'])['maxLevel'] = 5;

    const result = validateConfig(config);
    expect(codes(result)).toContain('invalid_value');
  });

  it('被动开场效果必须带 target', () => {
    const config = cloneFixture();
    asRecordArray(config['passives'])[0]!['effects'] = [
      { kind: 'buff', value: 0.1, duration: 2, chance: 1, stat: 'atk' },
    ];

    const result = validateConfig(config);
    expect(codes(result)).toContain('invalid_value');
    expect(result.issues.some((i) => i.path.endsWith('.target'))).toBe(true);
  });
});

describe('validateConfig：contract-v1.2 栖息地可选字段（D-05/D-06）', () => {
  it('hungerPenaltyWhenNoFoodPerHour 与 productionStageMul 均合法时通过', () => {
    const config = cloneFixture();
    const habitat = asRecord(asRecordArray(config['habitats'])[0]!);
    habitat['hungerPenaltyWhenNoFoodPerHour'] = 5;
    habitat['productionStageMul'] = { juvenile: 0.5, adult: 1, elder: 0.8 };

    expect(validateConfig(config).issues).toEqual([]);
  });

  it('hungerPenaltyWhenNoFoodPerHour 为负数时报 out_of_range', () => {
    const config = cloneFixture();
    asRecord(asRecordArray(config['habitats'])[0]!)['hungerPenaltyWhenNoFoodPerHour'] = -1;
    expect(codes(validateConfig(config))).toContain('out_of_range');
  });

  it('productionStageMul 缺少字段 / 非对象时报错', () => {
    const missing = cloneFixture();
    asRecord(asRecordArray(missing['habitats'])[0]!)['productionStageMul'] = {
      juvenile: 0.5,
      adult: 1,
    };
    expect(codes(validateConfig(missing))).toContain('invalid_type');

    const notObject = cloneFixture();
    asRecord(asRecordArray(notObject['habitats'])[0]!)['productionStageMul'] = 3;
    expect(codes(validateConfig(notObject))).toContain('invalid_type');
  });

  it('productionStageMul 数值超出非负范围时报 out_of_range', () => {
    const config = cloneFixture();
    asRecord(asRecordArray(config['habitats'])[0]!)['productionStageMul'] = {
      juvenile: -0.1,
      adult: 1,
      elder: 0.8,
    };
    expect(codes(validateConfig(config))).toContain('out_of_range');
  });
});

describe('validateConfig：careRecoveryPerAction（contract-v1.3 D-12）', () => {
  it('clean/play 可选且非负时通过（允许只填一个）', () => {
    const full = cloneFixture();
    asRecord(asRecordArray(full['habitats'])[0]!)['careRecoveryPerAction'] = {
      clean: 15,
      play: 10,
    };
    expect(validateConfig(full).issues).toEqual([]);

    const partial = cloneFixture();
    asRecord(asRecordArray(partial['habitats'])[0]!)['careRecoveryPerAction'] = { clean: 5 };
    expect(validateConfig(partial).issues).toEqual([]);
  });

  it('负数报 out_of_range，非对象报 invalid_type', () => {
    const negative = cloneFixture();
    asRecord(asRecordArray(negative['habitats'])[0]!)['careRecoveryPerAction'] = { play: -1 };
    expect(codes(validateConfig(negative))).toContain('out_of_range');

    const notObject = cloneFixture();
    asRecord(asRecordArray(notObject['habitats'])[0]!)['careRecoveryPerAction'] = 5;
    expect(codes(validateConfig(notObject))).toContain('invalid_type');
  });
});
