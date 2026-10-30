// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/** 账号与登录（ONLINE_DESIGN §2/§3）。 */
import type { EpochMs } from '../core';

export type AuthProvider = 'wechat' | 'steam' | 'guest';

export interface AuthWechatRequest {
  /** `wx.login()` 返回的 code。 */
  code: string;
}

export interface AuthSteamRequest {
  /** Steamworks 会话票据；服务端必须校验，不能信客户端传的 steamId。 */
  ticket: string;
}

export interface AuthGuestRequest {
  /** 本地持久化的设备 id。 */
  deviceId: string;
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface AccountBindings {
  wechat?: { openid: string; unionid?: string };
  steam?: { steamId: string };
  guest?: { deviceId: string };
}

export interface AuthAccount {
  id: string;
  displayName: string;
  region: 'cn' | 'global';
  bindings: AccountBindings;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  account: AuthAccount;
  /** 登录后可立即拉档，减少一次往返。 */
  profileRevision: number;
  serverTime: EpochMs;
}

export interface AccountBindRequest {
  provider: AuthProvider;
  /** 对应平台的凭证（微信 code / Steam ticket / 设备 id）。 */
  credential: string;
}

export interface AccountUnbindRequest {
  provider: AuthProvider;
}

export interface AccountOpResponse {
  account: AuthAccount;
  serverTime: EpochMs;
}
