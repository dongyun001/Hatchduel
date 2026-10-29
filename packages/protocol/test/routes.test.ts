import { describe, expect, it } from 'vitest';

import {
  API_ERROR_CODES,
  BASE_REVISION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  PROTOCOL_VERSION,
  ROUTES,
  WRITE_ROUTE_KEYS,
  isWriteRoute,
  type ApiContract,
  type RouteKey,
} from '@petbattle/protocol';

// 编译期断言：ApiContract 与 ROUTES 的 key 必须完全一致。
type MissingContractKeys = Exclude<RouteKey, keyof ApiContract>;
type ExtraContractKeys = Exclude<keyof ApiContract, RouteKey>;
const contractCoversAllRoutes: MissingContractKeys extends never ? true : false = true;
const contractHasNoExtraRoutes: ExtraContractKeys extends never ? true : false = true;

describe('protocol contract-v1', () => {
  it('协议版本为 v1', () => {
    expect(PROTOCOL_VERSION).toBe('v1');
  });

  it('ApiContract 与 ROUTES 一一对应', () => {
    expect(contractCoversAllRoutes).toBe(true);
    expect(contractHasNoExtraRoutes).toBe(true);
  });

  it('路由以 / 开头且 method + path 唯一', () => {
    const seen = new Set<string>();
    for (const spec of Object.values(ROUTES)) {
      expect(spec.path.startsWith('/')).toBe(true);
      const key = `${spec.method} ${spec.path}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('所有 POST 都是写路由（需 Idempotency-Key），GET 不是', () => {
    for (const [key, spec] of Object.entries(ROUTES)) {
      expect(isWriteRoute(key as RouteKey)).toBe(spec.method === 'POST');
    }
    const posts = Object.values(ROUTES).filter((spec) => spec.method === 'POST');
    expect(WRITE_ROUTE_KEYS).toHaveLength(posts.length);
  });

  it('关键端点已冻结（lineup 与 pvp/defense 分离）', () => {
    expect(ROUTES.setLineup.path).toBe('/lineup/set');
    expect(ROUTES.setPvpDefense.path).toBe('/pvp/defense');
    expect(ROUTES.startPveBattle.path).toBe('/battle/pve/start');
    expect(ROUTES.claimPveBattle.path).toBe('/battle/pve/claim');
    expect(ROUTES.getProfile.path).toBe('/profile');
    expect(ROUTES.renamePet.path).toBe('/pets/:id/rename');
    expect(ROUTES.setPetLock.path).toBe('/pets/:id/lock');
    expect(ROUTES.releasePet.path).toBe('/pets/:id/release');
  });

  it('写操作 header 常量已冻结', () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe('Idempotency-Key');
    expect(BASE_REVISION_HEADER).toBe('X-Base-Revision');
  });

  it('错误码 key 与值一致且不重复', () => {
    const values = Object.values(API_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    for (const [key, value] of Object.entries(API_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
