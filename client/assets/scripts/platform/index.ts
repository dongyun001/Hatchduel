import type { PlatformAdapter } from './types';
import { SteamPlatform, hasSteamBridge } from './steam';
import { WebPlatform } from './web';
import { WechatPlatform, isWechatRuntime } from './wechat';

export type { HttpRequest, HttpResponse, PlatformAdapter, PlatformKind, PlatformLoginResult } from './types';

let current: PlatformAdapter | null = null;

/**
 * 选择平台适配器：微信运行时优先，其次 Steam 桥接，最后 Web（编辑器预览 / 开发）。
 * 只在 Boot 调一次；其他层通过返回值或 `getPlatform()` 使用。
 */
export function initPlatform(): PlatformAdapter {
  if (current) return current;
  if (isWechatRuntime()) current = new WechatPlatform();
  else if (hasSteamBridge()) current = new SteamPlatform();
  else current = new WebPlatform();
  return current;
}

export function getPlatform(): PlatformAdapter {
  if (!current) throw new Error('平台适配器尚未初始化：请先在 Boot 调用 initPlatform()');
  return current;
}
