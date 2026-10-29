import { describe, expect, it } from 'vitest';

import { Router, matchPath } from '../src/http/router.js';

describe('matchPath', () => {
  it('静态路径精确匹配', () => {
    expect(matchPath('/profile/rename', '/profile/rename')).toEqual({});
    expect(matchPath('/profile/rename', '/profile')).toBeUndefined();
  });

  it('忽略尾部斜杠与前后空段', () => {
    expect(matchPath('/profile', '/profile/')).toEqual({});
    expect(matchPath('/profile', '//profile//')).toEqual({});
  });

  it('解析 :id 参数并解码', () => {
    expect(matchPath('/pets/:id/rename', '/pets/pet%201/rename')).toEqual({ id: 'pet 1' });
  });

  it('段数不同不匹配', () => {
    expect(matchPath('/pets/:id/rename', '/pets/pet1')).toBeUndefined();
  });

  it('非法百分号编码按不匹配处理，不抛异常', () => {
    expect(matchPath('/pets/:id/rename', '/pets/%zz/rename')).toBeUndefined();
  });
});

describe('Router', () => {
  const router = new Router<string>();
  router.add('GET', '/profile', 'getProfile');
  router.add('POST', '/pets/:id/lock', 'setPetLock');

  it('按 method + 路径匹配，返回 meta 与参数', () => {
    expect(router.match('GET', '/profile')?.meta).toBe('getProfile');
    expect(router.match('POST', '/pets/p1/lock')).toEqual({
      params: { id: 'p1' },
      meta: 'setPetLock',
    });
  });

  it('method 不匹配返回 undefined', () => {
    expect(router.match('POST', '/profile')).toBeUndefined();
  });

  it('未知路径返回 undefined', () => {
    expect(router.match('GET', '/nope')).toBeUndefined();
  });
});
