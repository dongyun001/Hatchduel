/**
 * 平台适配器契约（TECH_DESIGN §6.4）。
 *
 * `app/` 只依赖这个接口；`wx.*` 只允许出现在 `platform/wechat.ts`。
 */
export type PlatformKind = 'wechat' | 'web' | 'steam';

export interface PlatformLoginResult {
  kind: PlatformKind;
  /** 平台凭证：微信 code / Steam ticket / 本地设备 id。 */
  credential: string;
}

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  /** 已序列化的 JSON 字符串；GET 为 undefined。 */
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** 原始响应文本；由 ApiClient 负责 JSON 解析。 */
  body: string;
}

export interface PlatformAdapter {
  readonly kind: PlatformKind;
  /** 平台登录；返回的凭证交给服务端 /auth/*。 */
  login(): Promise<PlatformLoginResult>;
  getStorage<T>(key: string): Promise<T | null>;
  setStorage<T>(key: string, value: T): Promise<void>;
  /** 仅用于展示；权威时间来自 `ApiResponse.serverTime`。 */
  now(): number;
  request(req: HttpRequest): Promise<HttpResponse>;
  vibrate?(type: 'light' | 'medium'): void;
}
