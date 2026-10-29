import type { HttpRequest, HttpResponse, PlatformAdapter, PlatformLoginResult } from './types';

/**
 * Web / 编辑器预览适配器：fetch + localStorage。
 * 登录用持久化的本地设备 id（服务端走 /auth/guest）。
 */
const DEVICE_ID_KEY = 'petbattle.deviceId';

function loadDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `web-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export class WebPlatform implements PlatformAdapter {
  readonly kind = 'web' as const;

  async login(): Promise<PlatformLoginResult> {
    return { kind: 'web', credential: loadDeviceId() };
  }

  async getStorage<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setStorage<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }

  now(): number {
    return Date.now();
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return { status: res.status, body: await res.text() };
  }
}
