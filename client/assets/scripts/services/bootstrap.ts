import { appStore } from '../app/store';
import { DEV_CONFIG } from '../dev/devConfig';
import { createMockProfile } from '../dev/mockProfile';
import { initPlatform } from '../platform';
import type { PlatformAdapter } from '../platform';
import { ApiClient } from './apiClient';
import { loadConfigRepo } from './config';

let platform: PlatformAdapter | null = null;
let apiClient: ApiClient | null = null;
let runtimeConfig = { useServer: DEV_CONFIG.useServer, apiBaseUrl: DEV_CONFIG.apiBaseUrl };

export function getPlatformAdapter(): PlatformAdapter {
  if (!platform) throw new Error('平台适配器尚未初始化');
  return platform;
}

/** 本次启动实际生效的 dev 配置（可能被本地存储覆盖）。 */
export function getRuntimeConfig(): { useServer: boolean; apiBaseUrl: string } {
  return runtimeConfig;
}

/** 服务端客户端；mock 模式下为 null。 */
export function getApiClient(): ApiClient | null {
  return apiClient;
}

/** 平台时间（仅展示/本地演示）；Boot 未跑时退化为本机时间，保证单场景预览不崩。 */
export function nowMs(): number {
  return platform ? platform.now() : Date.now();
}

/** 读取本地存储的 dev 覆盖；未开启或没有值时回退构建默认。 */
async function readOverride<T>(adapter: PlatformAdapter, key: string, fallback: T): Promise<T> {
  if (!DEV_CONFIG.allowRuntimeStorageOverrides) return fallback;
  const value = await adapter.getStorage<T>(key);
  return value ?? fallback;
}

export type BootstrapMode = 'mock' | 'server';

export interface BootstrapResult {
  platform: PlatformAdapter;
  mode: BootstrapMode;
}

/**
 * Boot 的统一初始化：
 * 1. 选择平台适配器（wx / steam / web）；
 * 2. 读写一次本地存储，验证 adapter 通路；
 * 3. `useServer` 时登录并拉全量档，失败则退回离线 mock；
 * 4. 把 profile 写进 store（UI 只读 store）。
 */
export async function bootstrapApp(): Promise<BootstrapResult> {
  const adapter = initPlatform();
  platform = adapter;
  appStore.update((prev) => ({ ...prev, platformKind: adapter.kind }));

  const launches = ((await adapter.getStorage<number>('petbattle.launches')) ?? 0) + 1;
  await adapter.setStorage('petbattle.launches', launches);

  // 配置先于存档：mock 建体、详情/繁殖/栖息地都要用 ConfigRepo。
  const cfg = await loadConfigRepo();

  runtimeConfig = {
    useServer: await readOverride(adapter, 'petbattle.useServer', DEV_CONFIG.useServer),
    apiBaseUrl: await readOverride(adapter, 'petbattle.apiBaseUrl', DEV_CONFIG.apiBaseUrl),
  };

  if (runtimeConfig.useServer) {
    apiClient = new ApiClient({
      baseUrl: runtimeConfig.apiBaseUrl,
      platform: adapter,
      timeoutMs: DEV_CONFIG.requestTimeoutMs,
      getBaseRevision: () => appStore.getState().profile?.revision ?? 0,
      onProfile: (profile) => appStore.setProfile(profile),
      onServerTime: (offsetMs) => appStore.setRemote({ serverTimeOffsetMs: offsetMs }),
    });
    try {
      await apiClient.login();
      const remote = await apiClient.syncProfile();
      if (remote) {
        appStore.setRemote({ connected: true, mode: 'server', lastSyncAt: adapter.now() });
        return { platform: adapter, mode: 'server' };
      }
      appStore.setToast('服务端未返回存档，使用离线演示');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appStore.setToast(`服务端不可用，使用离线演示：${message}`);
      apiClient = null;
    }
  }

  appStore.setProfile(createMockProfile(adapter.now(), cfg));
  appStore.setRemote({ connected: false, mode: 'mock', lastSyncAt: null });
  return { platform: adapter, mode: 'mock' };
}
