import type { HttpRequest, HttpResponse, PlatformAdapter, PlatformLoginResult } from './types';

/**
 * 微信小游戏适配器。`wx.*` 只能出现在本文件（ESLint 约束 app 层）。
 *
 * 登录：`wx.login` 拿 code，服务端用 code 换 openid。
 * 存储：同步 API 包成 Promise；失败时返回 null / 静默失败。
 * 时间：`Date.now()` 只用于展示与超时，权威时间由服务端 `serverTime` 校正。
 */
interface WechatLoginResult {
  code: string;
  errMsg?: string;
}

interface WechatRequestOptions {
  url: string;
  method: 'GET' | 'POST';
  header?: Record<string, string>;
  data?: string;
  dataType?: 'json' | '其他';
  timeout?: number;
  success: (res: { statusCode: number; data: unknown }) => void;
  fail: (err: { errMsg?: string }) => void;
}

interface WechatApi {
  login(options: { success: (res: WechatLoginResult) => void; fail: (err: unknown) => void }): void;
  request(options: WechatRequestOptions): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  vibrateShort(options?: { type?: 'heavy' | 'medium' | 'light' }): void;
}

declare const wx: WechatApi | undefined;

export function isWechatRuntime(): boolean {
  return typeof wx !== 'undefined' && typeof wx.login === 'function';
}

function rawDataToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export class WechatPlatform implements PlatformAdapter {
  readonly kind = 'wechat' as const;

  login(): Promise<PlatformLoginResult> {
    return new Promise((resolve, reject) => {
      if (!wx) {
        reject(new Error('wx 不存在：当前不是微信小游戏运行时'));
        return;
      }
      wx.login({
        success: (res) => {
          if (res.code) resolve({ kind: 'wechat', credential: res.code });
          else reject(new Error(res.errMsg ?? 'wx.login 未返回 code'));
        },
        fail: (err) => reject(new Error(`wx.login 失败：${JSON.stringify(err)}`)),
      });
    });
  }

  getStorage<T>(key: string): Promise<T | null> {
    if (!wx) return Promise.resolve(null);
    const value = wx.getStorageSync(key);
    if (value === '' || value === undefined || value === null) return Promise.resolve(null);
    return Promise.resolve(value as T);
  }

  setStorage<T>(key: string, value: T): Promise<void> {
    if (!wx) return Promise.resolve();
    wx.setStorageSync(key, value);
    return Promise.resolve();
  }

  now(): number {
    return Date.now();
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      if (!wx) {
        reject(new Error('wx 不存在：当前不是微信小游戏运行时'));
        return;
      }
      wx.request({
        url: req.url,
        method: req.method,
        header: req.headers,
        data: req.body,
        dataType: 'json',
        timeout: req.timeoutMs ?? 10000,
        success: (res) => resolve({ status: res.statusCode, body: rawDataToString(res.data) }),
        fail: (err) => reject(new Error(`wx.request 失败：${err.errMsg ?? JSON.stringify(err)}`)),
      });
    });
  }

  vibrate(type: 'light' | 'medium' = 'light'): void {
    if (!wx) return;
    wx.vibrateShort({ type });
  }
}
