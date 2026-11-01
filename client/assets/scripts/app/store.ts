import type { BattleSetup, Profile } from '../../lib/core';
import type { PlatformKind } from '../platform';
import { saveLocalProfile } from '../services/localSave';

/**
 * 单向数据流：UI 只读 `appStore.getState()`，动作通过 service 改 store。
 * 不引入状态机；服务端返回 `ProfilePatch` 时由 service 合并后整体写回。
 */
export type ScreenId = 'boot' | 'home' | 'habitat' | 'petList' | 'petDetail' | 'breeding' | 'stageSelect' | 'battle';

/** 宠物列表筛选（阶段维度）。 */
export type PetFilter = 'all' | 'adult' | 'juvenile' | 'egg';

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
  /** 列表/详情/栖息地共用的当前选中宠物。 */
  selectedPetId: string | null;
  petFilter: PetFilter;
}

/** 当前 PvE 会话：setup 来自服务端或本地 buildPveBattleSetup；Battle 场景消费。 */
export interface BattleSessionState {
  mode: 'mock' | 'server';
  /** mock 模式没有服务端 battleId。 */
  battleId: string | null;
  stageId: string;
  setup: BattleSetup;
  /** 服务端会话过期时间；mock 为 null。 */
  expiresAt: number | null;
  /** 开战时的队伍快照（用于结算经验）。 */
  partyPetIds: string[];
}

export interface AppState {
  platformKind: PlatformKind | null;
  profile: Profile | null;
  remote: RemoteState;
  ui: UiState;
  battle: BattleSessionState | null;
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
    selectedPetId: null,
    petFilter: 'all',
  },
  battle: null,
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
    // 本地缓存只在 profile 变化时写；server 同步/409 也会走到这里，服务器档覆盖本地。
    void saveLocalProfile(profile);
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

  setSelectedPet(petId: string | null): void {
    this.update((prev) => ({ ...prev, ui: { ...prev.ui, selectedPetId: petId } }));
  }

  setPetFilter(petFilter: PetFilter): void {
    this.update((prev) => ({ ...prev, ui: { ...prev.ui, petFilter } }));
  }

  setRemote(remote: Partial<RemoteState>): void {
    this.update((prev) => ({ ...prev, remote: { ...prev.remote, ...remote } }));
  }

  setBattle(battle: BattleSessionState | null): void {
    this.update((prev) => ({ ...prev, battle }));
  }

  reset(): void {
    this.state = initialState;
    for (const listener of this.listeners) listener(this.state);
  }
}

export const appStore = new Store();
export type AppStore = Store;
