/** 开发开关。M1 默认离线 mock；可用本地存储临时切到服务端（仅 dev 调试）。 */
export const DEV_CONFIG = {
  /** true = Boot 尝试真实登录并拉档；false = 直接用 mock profile。 */
  useServer: false,
  apiBaseUrl: 'http://127.0.0.1:3000',
  requestTimeoutMs: 10000,
  /**
   * 允许用平台存储覆盖上面两项（键：`petbattle.useServer` / `petbattle.apiBaseUrl`）。
   * 用于同一个构建验证 mock 与 server 两条主流程；正式包应关掉。
   */
  allowRuntimeStorageOverrides: true,
} as const;
