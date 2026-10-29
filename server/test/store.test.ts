import { describe, expect, it } from 'vitest';

import type { Profile } from '@petbattle/core';

import { InMemoryStore } from '../src/storage/memory.js';
import type { AccountRecord, StoredResponse } from '../src/storage/types.js';

function account(id: string, deviceId: string): AccountRecord {
  return {
    id,
    displayName: '训练师',
    region: 'cn',
    status: 'active',
    createdAt: 1000,
    bindings: { guest: { deviceId } },
  };
}

/** 只关心 revision 的存档 fixture：store 层不校验领域内容。 */
function profileFixture(accountId: string, now = 1000, revision = 0): Profile {
  return {
    version: 1,
    accountId,
    revision,
    createdAt: now,
    lastEvaluatedAt: now,
    currencies: { coin: 0, food: 0, geneDust: 0, premium: 0 },
    pets: {},
    habitats: {},
    codex: {},
    lineup: [],
    stageProgress: {},
    breeding: { eggs: [], cooldowns: {} },
    pvp: { defense: [], rating: 1000, seasonId: 'preseason' },
    settings: { sfx: true, bgm: true },
    stats: {
      battlesWon: 0,
      battlesLost: 0,
      breeds: 0,
      hatchlings: 0,
      mutations: 0,
      released: 0,
    },
  };
}

describe('InMemoryStore：账号', () => {
  it('按绑定查找账号', async () => {
    const store = new InMemoryStore();
    await store.createAccount(account('acc_1', 'device-1'));

    const found = await store.findAccountByBinding('guest', 'device-1');
    expect(found?.id).toBe('acc_1');
    expect(await store.findAccountByBinding('guest', 'device-2')).toBeUndefined();
  });

  it('同一外部身份不能绑定两个账号', async () => {
    const store = new InMemoryStore();
    await store.createAccount(account('acc_1', 'device-1'));
    await expect(store.createAccount(account('acc_2', 'device-1'))).rejects.toThrow(/绑定已存在/);
  });

  it('返回的是深拷贝，改返回值不影响存储', async () => {
    const store = new InMemoryStore();
    await store.createAccount(account('acc_1', 'device-1'));

    const first = await store.findAccountByBinding('guest', 'device-1');
    if (first === undefined) throw new Error('账号不存在');
    first.displayName = '被篡改';
    first.bindings.guest = { deviceId: 'hacked' };

    const second = await store.findAccountByBinding('guest', 'device-1');
    expect(second?.displayName).toBe('训练师');
    expect(second?.bindings.guest?.deviceId).toBe('device-1');
  });
});

describe('InMemoryStore：存档 revision CAS', () => {
  it('期望版本一致才写入', async () => {
    const store = new InMemoryStore();
    await store.createProfile(profileFixture('acc_1', 1000));

    const current = await store.getProfile('acc_1');
    if (current === undefined) throw new Error('存档不存在');

    const next = { ...current, revision: 1, lastEvaluatedAt: 2000 };
    expect(await store.saveProfile(next, 0)).toBe(true);
    expect((await store.getProfile('acc_1'))?.revision).toBe(1);

    // 用过期版本再写必须失败，不能覆盖。
    expect(await store.saveProfile({ ...next, revision: 2 }, 0)).toBe(false);
    expect((await store.getProfile('acc_1'))?.revision).toBe(1);
  });

  it('存档不存在时 CAS 失败而不是凭空创建', async () => {
    const store = new InMemoryStore();
    expect(await store.saveProfile(profileFixture('ghost', 1000), 0)).toBe(false);
  });

  it('createProfile 幂等，重复创建不覆盖已有进度', async () => {
    const store = new InMemoryStore();
    await store.createProfile({ ...profileFixture('acc_1', 1000), revision: 5 });
    await store.createProfile(profileFixture('acc_1', 9999));
    expect((await store.getProfile('acc_1'))?.revision).toBe(5);
  });
});

describe('InMemoryStore：幂等与审计', () => {
  const stored: StoredResponse = {
    status: 200,
    body: { ok: true, serverTime: 1 },
    fingerprint: 'fp',
    createdAt: 1000,
    expiresAt: 2000,
  };

  it('未过期可读，过期即视为不存在', async () => {
    const store = new InMemoryStore();
    await store.putStoredResponse('acc_1', 'k1', stored);

    expect(await store.getStoredResponse('acc_1', 'k1', 1500)).toEqual(stored);
    expect(await store.getStoredResponse('acc_1', 'k1', 2000)).toBeUndefined();
    expect(await store.getStoredResponse('acc_2', 'k1', 1500)).toBeUndefined();
  });

  it('同 key 只保留第一次结果', async () => {
    const store = new InMemoryStore();
    await store.putStoredResponse('acc_1', 'k1', stored);
    await store.putStoredResponse('acc_1', 'k1', { ...stored, status: 500 });
    expect((await store.getStoredResponse('acc_1', 'k1', 1500))?.status).toBe(200);
  });

  it('审计按写入顺序保留', async () => {
    const store = new InMemoryStore();
    await store.appendAudit({ at: 1, accountId: 'acc_1', action: 'a' });
    await store.appendAudit({ at: 2, accountId: 'acc_1', action: 'b' });
    expect(store.listAudits().map((entry) => entry.action)).toEqual(['a', 'b']);
  });
});
