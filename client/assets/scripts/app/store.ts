import type { Profile } from '../../lib/core';
import type { PlatformKind } from '../platform';

/**
 * 单向数据流：UI 只读 `appStore.getState()`，动作通过 service 改 store。
 * 不引入状态机；服务端返回 `ProfilePatch` 时由 service 合并后整体写回。
 */
export type ScreenId = 'boot' | 'home' | 'habitat';

export interface RemoteState {
  /** mock 模式为 false；连服务端成功后为 true。 */
  connected: boolean;
  mode: 'mock' | 'server';
  /** serverTime - localNow；仅用于展示“服务器时间”。 */
  serverTimeOffsetMs: number;
  lastSyncAt: number | null;
}

export interface UiState {
  screen: ScreenId;
  toast: string | null;
  busy: boolean;
}

export interface AppState {
  platformKind: PlatformKind | null;
  profile: Profile | null;
  remote: RemoteState;
  ui: UiState;
}

const initialState: AppState = {
  platformKind: null,
  profile: null,
  remote: {
    connected: false,
    mode: 'mock',
    serverTimeOffsetMs: 0,
    lastSyncAt: null,
  },
  ui: {
    screen: 'boot',
    toast: null,
    busy: false,
  },
};

type Listener = (state: Readonly<AppState>) => void;

class Store {
  private state: AppState = initialState;
  private readonly listeners = new Set<Listener>();

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(updater: (prev: Readonly<AppState>) => AppState): void {
    this.state = updater(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  setProfile(profile: Profile): void {
    this.update((prev) => ({ ...prev, profile }));
  }

  setScreen(screen: ScreenId): void {
    this.update((prev) => ({ ...prev, ui: { ...prev.ui, screen } }));
  }

  setToast(toast: string | null): void {
    this.update((prev) => ({ ...prev, ui: { ...prev.ui, toast } }));
  }

  setBusy(busy: boolean): void {
    this.update((prev) => ({ ...prev, ui: { ...prev.ui, busy } }));
  }

  setRemote(remote: Partial<RemoteState>): void {
    this.update((prev) => ({ ...prev, remote: { ...prev.remote, ...remote } }));
  }

  reset(): void {
    this.state = initialState;
    for (const listener of this.listeners) listener(this.state);
  }
}

export const appStore = new Store();
export type AppStore = Store;
