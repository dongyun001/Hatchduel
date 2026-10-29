/**
 * 轻量路由：按 path 模板（`/pets/:id/rename`）匹配，method 精确比较。
 *
 * 为什么不用 Fastify/Express：锁文件由 0 号维护，C 不能新增依赖；2C2G 下零框架开销最小，
 * 且统一响应包/错误码需要完全可控（CONTRACT §8.3）。见 docs/ONLINE_DESIGN.md §5.4。
 */
import type { HttpMethod } from '@petbattle/protocol';

export interface RouteMatch<TParams extends Record<string, string>, TMeta> {
  params: TParams;
  meta: TMeta;
}

interface CompiledRoute<TMeta> {
  method: string;
  segments: string[];
  meta: TMeta;
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const patternSegments = split(pattern);
  const pathSegments = split(pathname);
  if (patternSegments.length !== pathSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index] as string;
    const pathSegment = pathSegments[index] as string;
    if (patternSegment.startsWith(':')) {
      if (pathSegment === '') return undefined;
      const decoded = decodeSegment(pathSegment);
      if (decoded === undefined) return undefined;
      params[patternSegment.slice(1)] = decoded;
      continue;
    }
    if (patternSegment !== pathSegment) return undefined;
  }
  return params;
}

function split(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** 非法百分号编码（如 `%zz`）不应把请求变成 500，按“不匹配”处理。 */
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export class Router<TMeta> {
  private readonly routes: CompiledRoute<TMeta>[] = [];

  add(method: HttpMethod, path: string, meta: TMeta): void {
    this.routes.push({ method, segments: split(path), meta });
  }

  match(method: string, pathname: string): RouteMatch<Record<string, string>, TMeta> | undefined {
    const pathSegments = split(pathname);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const patternSegment = route.segments[index] as string;
        const pathSegment = pathSegments[index] as string;
        if (patternSegment.startsWith(':')) {
          if (pathSegment === '') {
            matched = false;
            break;
          }
          const decoded = decodeSegment(pathSegment);
          if (decoded === undefined) {
            matched = false;
            break;
          }
          params[patternSegment.slice(1)] = decoded;
          continue;
        }
        if (patternSegment !== pathSegment) {
          matched = false;
          break;
        }
      }
      if (matched) return { params, meta: route.meta };
    }
    return undefined;
  }
}
