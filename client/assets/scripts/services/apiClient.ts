import type { Profile } from '../../lib/core';
import {
  BASE_REVISION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  ROUTES,
  isWriteRoute,
} from '../../lib/protocol';
import type {
  ApiContract,
  ApiErrorCode,
  ApiResponse,
  AuthResponse,
  RevisionConflictDetails,
  RouteKey,
} from '../../lib/protocol';
import type { PlatformAdapter } from '../platform';

const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  platform: PlatformAdapter;
  /** 上次看到的 `profile.revision`；写操作放进 X-Base-Revision。 */
  getBaseRevision: () => number;
  /** 全量档到达（登录后 / 409 重建）时回调。 */
  onProfile: (profile: Profile) => void;
  /** serverTime 与本机时间的差值，仅用于展示。 */
  onServerTime?: (offsetMs: number) => void;
  timeoutMs?: number;
}

export interface CallOptions {
  /** 替换路径参数，例如 `{ id: 'pet-1' }`。 */
  pathParams?: Record<string, string>;
  /** 重试时复用同一个 key；缺省自动生成。 */
  idempotencyKey?: string;
  /** 显式声明是写操作（默认按 ROUTES 判断）。 */
  write?: boolean;
}

function fillPath(path: string, params?: Record<string, string>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`缺少路径参数 :${name}（${path}）`);
    return encodeURIComponent(value);
  });
}

function toQuery(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * 基于 `@petbattle/protocol` 的 ROUTES / ApiContract 发请求：
 * - 统一 `ApiResponse<T>`；
 * - 写操作自动带 Idempotency-Key / X-Base-Revision；
 * - 记录 serverTime 偏移（仅展示）；
 * - 409 REVISION_CONFLICT 用 `latestProfile` 重建，并再拉一次全量档。
 */
export class ApiClient {
  private token: string | null = null;
  private offsetMs = 0;
  private sequence = 0;
  private readonly baseUrl: string;
  private readonly platform: PlatformAdapter;
  private readonly getBaseRevision: () => number;
  private readonly onProfile: (profile: Profile) => void;
  private readonly onServerTime: (offsetMs: number) => void;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.platform = options.platform;
    this.getBaseRevision = options.getBaseRevision;
    this.onProfile = options.onProfile;
    this.onServerTime = options.onServerTime ?? (() => undefined);
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  get serverTimeOffsetMs(): number {
    return this.offsetMs;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async login(): Promise<AuthResponse> {
    const platformLogin = await this.platform.login();
    const response =
      platformLogin.kind === 'wechat'
        ? await this.call('authWechat', { code: platformLogin.credential })
        : platformLogin.kind === 'steam'
          ? await this.call('authSteam', { ticket: platformLogin.credential })
          : await this.call('authGuest', { deviceId: platformLogin.credential });
    if (!response.ok || !response.data) {
      const code = response.error?.code ?? 'INTERNAL';
      throw new ApiRequestError(code, response.error?.message ?? '登录失败');
    }
    this.setToken(response.data.token);
    return response.data;
  }

  /** 拉全量档；成功时写入 store 并返回。 */
  async syncProfile(): Promise<Profile | null> {
    const response = await this.call('getProfile', undefined);
    if (!response.ok || !response.data) return null;
    this.onProfile(response.data.profile);
    return response.data.profile;
  }

  async call<K extends RouteKey>(
    key: K,
    payload: ApiContract[K]['request'],
    options: CallOptions = {},
  ): Promise<ApiResponse<ApiContract[K]['response']>> {
    const route = ROUTES[key];
    const path = fillPath(route.path, options.pathParams);
    const isWrite = options.write ?? isWriteRoute(key);
    const headers: Record<string, string> = {
      ...JSON_HEADERS,
      [PROTOCOL_VERSION_HEADER]: PROTOCOL_VERSION,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (isWrite) {
      headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey ?? this.nextIdempotencyKey();
      headers[BASE_REVISION_HEADER] = String(this.getBaseRevision());
    }

    let url = `${this.baseUrl}${path}`;
    let body: string | undefined;
    if (route.method === 'GET') url += toQuery(payload);
    else body = JSON.stringify(payload ?? {});

    let parsed: ApiResponse<ApiContract[K]['response']> | null = null;
    try {
      const response = await this.platform.request({
        method: route.method,
        url,
        headers,
        body,
        timeoutMs: this.timeoutMs,
      });
      parsed = this.parseResponse<ApiContract[K]['response']>(response.body, response.status);
    } catch (error) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) },
        serverTime: this.platform.now(),
      };
    }
    if (!parsed) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: '响应不是合法 JSON' },
        serverTime: this.platform.now(),
      };
    }
    if (typeof parsed.serverTime === 'number') {
      this.offsetMs = parsed.serverTime - this.platform.now();
      this.onServerTime(this.offsetMs);
    }
    if (!parsed.ok && parsed.error?.code === 'REVISION_CONFLICT') {
      this.recoverFromConflict(parsed.error.details);
    }
    return parsed;
  }

  private parseResponse<T>(body: string, status: number): ApiResponse<T> | null {
    if (!body) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: `HTTP ${status}：空响应` },
        serverTime: this.platform.now(),
      };
    }
    try {
      return JSON.parse(body) as ApiResponse<T>;
    } catch {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: `HTTP ${status}：响应不是 JSON` },
        serverTime: this.platform.now(),
      };
    }
  }

  /** 409：先用 details.latestProfile 重建，再拉一次全量档（契约 §4.1）。 */
  private recoverFromConflict(details: unknown): void {
    const conflict = details as RevisionConflictDetails | undefined;
    if (conflict?.latestProfile) this.onProfile(conflict.latestProfile);
    void this.syncProfile();
  }

  private nextIdempotencyKey(): string {
    this.sequence += 1;
    return `idem-${this.platform.now().toString(36)}-${this.sequence}`;
  }
}
