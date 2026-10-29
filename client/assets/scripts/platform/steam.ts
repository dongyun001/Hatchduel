import type { HttpRequest, HttpResponse, PlatformAdapter, PlatformLoginResult } from './types';
import { WebPlatform } from './web';

/**
 * Steam 适配器。
 *
 * Steamworks 是原生 SDK，JS 层只能通过宿主桥接访问；本文件约定一个最小桥接：
 * `globalThis.petbattleSteam.login()` 返回会话票据。桥接未注入时退化为 Web 实现，
 * 保证桌面调试可用，但**不能**把退化结果当作正式 Steam 登录。
 */
export interface SteamBridge {
  login(): Promise<{ ticket: string }>;
  request?(req: HttpRequest): Promise<HttpResponse>;
  vibrate?(type: 'light' | 'medium'): void;
}

type SteamGlobal = typeof globalThis & { petbattleSteam?: SteamBridge };

function getBridge(): SteamBridge | null {
  const g = globalThis as SteamGlobal;
  return g.petbattleSteam ?? null;
}

export function hasSteamBridge(): boolean {
  return getBridge() !== null;
}

export class SteamPlatform implements PlatformAdapter {
  readonly kind = 'steam' as const;
  private readonly fallback = new WebPlatform();

  async login(): Promise<PlatformLoginResult> {
    const bridge = getBridge();
    if (!bridge) return { kind: 'steam', credential: `steam-dev-${await this.deviceId()}` };
    const { ticket } = await bridge.login();
    return { kind: 'steam', credential: ticket };
  }

  getStorage<T>(key: string): Promise<T | null> {
    return this.fallback.getStorage<T>(key);
  }

  setStorage<T>(key: string, value: T): Promise<void> {
    return this.fallback.setStorage(key, value);
  }

  now(): number {
    return Date.now();
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    const bridge = getBridge();
    if (bridge?.request) return bridge.request(req);
    return this.fallback.request(req);
  }

  vibrate(type: 'light' | 'medium' = 'light'): void {
    getBridge()?.vibrate?.(type);
  }

  private async deviceId(): Promise<string> {
    const key = 'petbattle.steamDeviceId';
    const stored = await this.fallback.getStorage<string>(key);
    if (stored) return stored;
    const created = `steam-${Date.now().toString(36)}`;
    await this.fallback.setStorage(key, created);
    return created;
  }
}
