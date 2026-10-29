import { SpriteFrame, Texture2D, resources } from 'cc';

/**
 * 占位图加载（ART_SPEC §8.3）。占位图放在 `assets/resources/placeholders/`，
 * 尺寸与最终资源一致，替换美术后路径不变。
 *
 * 像素风强制：运行时把过滤改成 NEAREST、关闭 mipmap（PITFALLS P-109），
 * 即使导入设置被误改也不会出现模糊。
 */
export interface PlaceholderFrames {
  white: SpriteFrame;
  petTurtle: SpriteFrame;
  petFish: SpriteFrame;
  petFrog: SpriteFrame;
  iconCoin: SpriteFrame;
  iconFood: SpriteFrame;
  iconGene: SpriteFrame;
}

const PATHS = {
  white: 'placeholders/white',
  petTurtle: 'placeholders/pet_turtle_water_idle',
  petFish: 'placeholders/pet_fish_thunder_idle',
  petFrog: 'placeholders/pet_frog_grass_idle',
  iconCoin: 'placeholders/icon_coin',
  iconFood: 'placeholders/icon_food',
  iconGene: 'placeholders/icon_gene',
} as const;

let cached: PlaceholderFrames | null = null;
let loading: Promise<PlaceholderFrames> | null = null;

function loadFrame(path: string): Promise<SpriteFrame> {
  return new Promise((resolve, reject) => {
    resources.load(`${path}/spriteFrame`, SpriteFrame, (error, frame) => {
      if (error) {
        reject(error);
        return;
      }
      frame.texture.setFilters(Texture2D.Filter.NEAREST, Texture2D.Filter.NEAREST);
      frame.texture.setMipFilter(Texture2D.Filter.NONE);
      resolve(frame);
    });
  });
}

export function preloadPlaceholders(): Promise<PlaceholderFrames> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = Promise.all([
      loadFrame(PATHS.white),
      loadFrame(PATHS.petTurtle),
      loadFrame(PATHS.petFish),
      loadFrame(PATHS.petFrog),
      loadFrame(PATHS.iconCoin),
      loadFrame(PATHS.iconFood),
      loadFrame(PATHS.iconGene),
    ]).then(([white, petTurtle, petFish, petFrog, iconCoin, iconFood, iconGene]) => {
      cached = { white, petTurtle, petFish, petFrog, iconCoin, iconFood, iconGene };
      return cached;
    });
  }
  return loading;
}
