/** 开发开关。M0/M1 默认离线 mock，不依赖服务端即可跑通场景。 */
export const DEV_CONFIG = {
  /** true = Boot 尝试真实登录并拉档；false = 直接用 mock profile。 */
  useServer: false,
  apiBaseUrl: 'http://127.0.0.1:3000',
  requestTimeoutMs: 10000,
} as const;
