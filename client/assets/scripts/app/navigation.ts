import { director } from 'cc';
import { appStore } from './store';

/** 场景名与 settings 中注册的场景一致（含 M2 的 PvP / 排行榜）。 */
export const SCENES = {
  boot: 'Boot',
  home: 'Home',
  habitat: 'Habitat',
  petList: 'PetList',
  petDetail: 'PetDetail',
  breeding: 'Breeding',
  stageSelect: 'StageSelect',
  battle: 'Battle',
  pvpDefense: 'PvpDefense',
  pvpOpponent: 'PvpOpponent',
  pvpResult: 'PvpResult',
  pvpReplay: 'PvpReplay',
  leaderboard: 'Leaderboard',
} as const;

export type SceneKey = keyof typeof SCENES;

export function gotoScene(key: SceneKey): void {
  // 清掉上一个场景的 Toast：SceneView 的 2.5s 清理定时器挂在被销毁的组件上，
  // 不主动清会让 toast 常驻并挡住底部按钮（实测 PvP 返回主页后发生过）。
  appStore.setToast(null);
  director.loadScene(SCENES[key]);
}
