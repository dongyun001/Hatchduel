import { describe, expect, it } from 'vitest';

import {
  CONDITION_MUL_BASE,
  COUNTER_STRONG,
  COUNTER_WEAK,
  DAMAGE_K,
  DECAY_CAP_MS,
  ENERGY_INITIAL,
  ENERGY_MAX,
  ENERGY_ON_NORMAL_HIT,
  ENERGY_PER_TURN,
  GENE_MUL_BASE,
  HEALTH_FLOOR,
  INBREEDING_GENERATIONS,
  MAX_LINEUP_SIZE,
  MAX_TURNS,
  MVP_ELEMENT_IDS,
  MVP_SPECIES_IDS,
  OFFLINE_CAP_MS,
  STAGE_MULTIPLIERS,
} from '@petbattle/core';


describe('冻结常量', () => {
  it('战斗数值与 AGENTS §3.5 一致', () => {
    expect(DAMAGE_K).toBe(400);
    expect(ENERGY_MAX).toBe(100);
    expect(ENERGY_INITIAL).toBe(0);
    expect(ENERGY_PER_TURN).toBe(20);
    expect(ENERGY_ON_NORMAL_HIT).toBe(10);
    expect(MAX_TURNS).toBe(30);
    expect(COUNTER_STRONG).toBe(1.25);
    expect(COUNTER_WEAK).toBe(0.85);
  });

  it('成长/衰减/健康地板与 AGENTS §3.4/§3.6 一致', () => {
    expect(STAGE_MULTIPLIERS.juvenile).toBe(0.7);
    expect(STAGE_MULTIPLIERS.adult).toBe(1);
    expect(STAGE_MULTIPLIERS.elder).toBe(0.9);
    expect(GENE_MUL_BASE).toBe(0.85);
    expect(CONDITION_MUL_BASE).toBe(0.9);
    expect(INBREEDING_GENERATIONS).toBe(3);
    expect(OFFLINE_CAP_MS).toBe(8 * 60 * 60 * 1000);
    expect(DECAY_CAP_MS).toBe(24 * 60 * 60 * 1000);
    expect(HEALTH_FLOOR).toBe(1);
    expect(MAX_LINEUP_SIZE).toBe(3);
  });

  it('MVP 物种与属性集合已收窄', () => {
    expect([...MVP_SPECIES_IDS]).toEqual(['turtle', 'fish', 'frog', 'cat', 'snake']);
    expect([...MVP_ELEMENT_IDS]).toEqual(['water', 'fire', 'grass', 'earth', 'thunder']);
  });
});
