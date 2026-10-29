import { appStore } from '../app/store';
import { DEV_CONFIG } from '../dev/devConfig';
import { createMockProfile } from '../dev/mockProfile';
import { initPlatform } from '../platform';
import type { PlatformAdapter } from '../platform';
import { ApiClient } from './apiClient';

let platform: PlatformAdapter | null = null;
let apiClient: ApiClient | null = null;

export function getPlatformAdapter(): PlatformAdapter {
  if (!platform) throw new Error('平台适配器尚未初始化');
  return platform;
}

/** 服务端客户端；mock 模式下为 null。 */
export function getApiClient(): ApiClient | null {
  return apiClient;
}

/** 平台时间（仅展示/本地演示）；Boot 未跑时退化为本机时间，保证单场景预览不崩。 */
export function nowMs(): number {
  return platform ? platform.now() : Date.now();
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

  if (DEV_CONFIG.useServer) {
    apiClient = new ApiClient({
      baseUrl: DEV_CONFIG.apiBaseUrl,
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

  appStore.setProfile(createMockProfile(adapter.now()));
  appStore.setRemote({ connected: false, mode: 'mock', lastSyncAt: null });
  return { platform: adapter, mode: 'mock' };
}
