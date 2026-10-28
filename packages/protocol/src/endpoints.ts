/**
 * 端点表与请求/响应映射（ONLINE_DESIGN §5.2，contract-v1）。
 *
 * 客户端/服务端都从 `ROUTES` 取路径，禁止硬编码字符串；
 * `ApiContract` 把每个路由映射到 request/response 类型，编译期保证两端一致。
 */
import type {
  AccountBindRequest,
  AccountOpResponse,
  AccountUnbindRequest,
  AuthGuestRequest,
  AuthRefreshRequest,
  AuthResponse,
  AuthSteamRequest,
  AuthWechatRequest,
} from './auth.js';
import type { ClaimPveBattleRequest, ClaimPveBattleResponse, StartPveBattleRequest, StartPveBattleResponse } from './battle.js';
import type { ClaimBreedingRequest, ClaimBreedingResponse, StartBreedingRequest, StartBreedingResponse } from './breeding.js';
import type { ListFriendsResponse, VisitFriendRequest, VisitFriendResponse } from './friends.js';
import type {
  CleanPetRequest,
  CollectHabitatRequest,
  CollectHabitatResponse,
  FeedPetRequest,
  PlayWithPetRequest,
  UpgradeHabitatRequest,
} from './habitat.js';
import type { LeaderboardQuery, LeaderboardResponse } from './leaderboard.js';
import type { SetLineupRequest, SetLineupResponse } from './lineup.js';
import type { RenamePetRequest, ReleasePetResponse, SetPetLockRequest } from './pets.js';
import type { GetProfileResponse, RenameProfileRequest } from './profile.js';
import type { ProfileWriteResponse } from './profile.js';
import type { GetPvpReplayResponse, GetPvpOpponentResponse, FightPvpRequest, FightPvpResponse, SetPvpDefenseRequest } from './pvp.js';

export const ROUTES = {
  authWechat: { method: 'POST', path: '/auth/wechat' },
  authSteam: { method: 'POST', path: '/auth/steam' },
  authGuest: { method: 'POST', path: '/auth/guest' },
  authRefresh: { method: 'POST', path: '/auth/refresh' },

  accountBind: { method: 'POST', path: '/account/bind' },
  accountUnbind: { method: 'POST', path: '/account/unbind' },

  getProfile: { method: 'GET', path: '/profile' },
  renameProfile: { method: 'POST', path: '/profile/rename' },

  collectHabitat: { method: 'POST', path: '/habitat/collect' },
  feedPet: { method: 'POST', path: '/habitat/feed' },
  cleanPet: { method: 'POST', path: '/habitat/clean' },
  playWithPet: { method: 'POST', path: '/habitat/play' },
  upgradeHabitat: { method: 'POST', path: '/habitat/upgrade' },

  renamePet: { method: 'POST', path: '/pets/:id/rename' },
  setPetLock: { method: 'POST', path: '/pets/:id/lock' },
  releasePet: { method: 'POST', path: '/pets/:id/release' },

  startBreeding: { method: 'POST', path: '/breeding/start' },
  claimBreeding: { method: 'POST', path: '/breeding/claim' },

  startPveBattle: { method: 'POST', path: '/battle/pve/start' },
  claimPveBattle: { method: 'POST', path: '/battle/pve/claim' },

  setLineup: { method: 'POST', path: '/lineup/set' },

  setPvpDefense: { method: 'POST', path: '/pvp/defense' },
  getPvpOpponent: { method: 'GET', path: '/pvp/opponent' },
  fightPvp: { method: 'POST', path: '/pvp/fight' },
  getPvpReplay: { method: 'GET', path: '/pvp/replay/:id' },

  getLeaderboard: { method: 'GET', path: '/leaderboard' },
  listFriends: { method: 'GET', path: '/friends' },
  visitFriend: { method: 'POST', path: '/friends/:id/visit' },
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RouteSpec = (typeof ROUTES)[RouteKey];
export type HttpMethod = RouteSpec['method'];

/** 每个路由的请求/响应类型。GET 的 request 为 void。 */
export interface ApiContract {
  authWechat: { request: AuthWechatRequest; response: AuthResponse };
  authSteam: { request: AuthSteamRequest; response: AuthResponse };
  authGuest: { request: AuthGuestRequest; response: AuthResponse };
  authRefresh: { request: AuthRefreshRequest; response: AuthResponse };

  accountBind: { request: AccountBindRequest; response: AccountOpResponse };
  accountUnbind: { request: AccountUnbindRequest; response: AccountOpResponse };

  getProfile: { request: void; response: GetProfileResponse };
  renameProfile: { request: RenameProfileRequest; response: ProfileWriteResponse };

  collectHabitat: { request: CollectHabitatRequest; response: CollectHabitatResponse };
  feedPet: { request: FeedPetRequest; response: ProfileWriteResponse };
  cleanPet: { request: CleanPetRequest; response: ProfileWriteResponse };
  playWithPet: { request: PlayWithPetRequest; response: ProfileWriteResponse };
  upgradeHabitat: { request: UpgradeHabitatRequest; response: ProfileWriteResponse };

  renamePet: { request: RenamePetRequest; response: ProfileWriteResponse };
  setPetLock: { request: SetPetLockRequest; response: ProfileWriteResponse };
  releasePet: { request: void; response: ReleasePetResponse };

  startBreeding: { request: StartBreedingRequest; response: StartBreedingResponse };
  claimBreeding: { request: ClaimBreedingRequest; response: ClaimBreedingResponse };

  startPveBattle: { request: StartPveBattleRequest; response: StartPveBattleResponse };
  claimPveBattle: { request: ClaimPveBattleRequest; response: ClaimPveBattleResponse };

  setLineup: { request: SetLineupRequest; response: SetLineupResponse };

  setPvpDefense: { request: SetPvpDefenseRequest; response: ProfileWriteResponse };
  getPvpOpponent: { request: void; response: GetPvpOpponentResponse };
  fightPvp: { request: FightPvpRequest; response: FightPvpResponse };
  getPvpReplay: { request: void; response: GetPvpReplayResponse };

  getLeaderboard: { request: LeaderboardQuery; response: LeaderboardResponse };
  listFriends: { request: void; response: ListFriendsResponse };
  visitFriend: { request: VisitFriendRequest; response: VisitFriendResponse };
}

/**
 * 需要 `Idempotency-Key` 的写路由。所有 POST 都在内；
 * 客户端对重复点击/重试复用同一个 key，服务端按 `(accountId, key)` 去重。
 */
export const WRITE_ROUTE_KEYS = [
  'authWechat',
  'authSteam',
  'authGuest',
  'authRefresh',
  'accountBind',
  'accountUnbind',
  'renameProfile',
  'collectHabitat',
  'feedPet',
  'cleanPet',
  'playWithPet',
  'upgradeHabitat',
  'renamePet',
  'setPetLock',
  'releasePet',
  'startBreeding',
  'claimBreeding',
  'startPveBattle',
  'claimPveBattle',
  'setLineup',
  'setPvpDefense',
  'fightPvp',
  'visitFriend',
] as const satisfies readonly RouteKey[];

export function isWriteRoute(key: RouteKey): boolean {
  return (WRITE_ROUTE_KEYS as readonly RouteKey[]).includes(key);
}
