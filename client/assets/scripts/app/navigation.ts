import { director } from 'cc';

/** 场景名与 settings 中注册的场景一致（Boot / Home / Habitat / PetList / PetDetail / Breeding / StageSelect / Battle）。 */
export const SCENES = {
  boot: 'Boot',
  home: 'Home',
  habitat: 'Habitat',
  petList: 'PetList',
  petDetail: 'PetDetail',
  breeding: 'Breeding',
  stageSelect: 'StageSelect',
  battle: 'Battle',
} as const;

export type SceneKey = keyof typeof SCENES;

export function gotoScene(key: SceneKey): void {
  director.loadScene(SCENES[key]);
}
