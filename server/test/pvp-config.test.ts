import { describe, expect, it } from 'vitest';

import { DEFAULT_PVP_SETTINGS, loadConfig } from '../src/config.js';

describe('PvpSettings 环境变量', () => {
  it('默认值按 CONTRACT §7.5 F-04', () => {
    const config = loadConfig({});
    expect(config.pvp).toEqual(DEFAULT_PVP_SETTINGS);
    expect(config.pvpSimulationConcurrency).toBe(2);
  });

  it('可用环境变量覆盖赛季/日报/TTL/机器人/并发', () => {
    const config = loadConfig({
      PETBATTLE_PVP_SEASON_ID: 's2',
      PETBATTLE_PVP_DAILY_LIMIT: '3',
      PETBATTLE_PVP_SNAPSHOT_TTL_MS: '1000',
      PETBATTLE_PVP_REPLAY_TTL_MS: '2000',
      PETBATTLE_PVP_BOTS: 'false',
      PETBATTLE_PVP_CONCURRENCY: '4',
    });

    expect(config.pvp.seasonId).toBe('s2');
    expect(config.pvp.dailyChallenges).toBe(3);
    expect(config.pvp.snapshotTtlMs).toBe(1000);
    expect(config.pvp.replayTtlMs).toBe(2000);
    expect(config.pvp.botsEnabled).toBe(false);
    expect(config.pvpSimulationConcurrency).toBe(4);
    // 冻结口径不走环境变量。
    expect(config.pvp.kWin).toBe(32);
    expect(config.pvp.matchWindows).toEqual([200, 600, Number.POSITIVE_INFINITY]);
  });

  it('非法数字/布尔值回落到默认值', () => {
    const config = loadConfig({
      PETBATTLE_PVP_DAILY_LIMIT: '0',
      PETBATTLE_PVP_REPLAY_TTL_MS: 'abc',
      PETBATTLE_PVP_BOTS: 'maybe',
      PETBATTLE_PVP_SEASON_ID: '   ',
    });

    expect(config.pvp.dailyChallenges).toBe(DEFAULT_PVP_SETTINGS.dailyChallenges);
    expect(config.pvp.replayTtlMs).toBe(DEFAULT_PVP_SETTINGS.replayTtlMs);
    expect(config.pvp.botsEnabled).toBe(true);
    expect(config.pvp.seasonId).toBe(DEFAULT_PVP_SETTINGS.seasonId);
  });
});
