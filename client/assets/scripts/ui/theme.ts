/** 像素基准与配色（ART_SPEC §1/§2）。1 美术像素 = 3 设计像素（1920×1080 = 640×360 × 3）。 */
export const DESIGN = {
  width: 1920,
  height: 1080,
  /** 1920 / 640；1280×720 时为 2。 */
  pixelScale: 3,
} as const;

/** 宠物战斗精灵基础尺寸（虚拟像素），显示时 × pixelScale。 */
export const SPRITE_SIZE = {
  pet: 96,
  /** 小型宠物（ART_SPEC §4.1），用于亲代卡片等空间有限的位置。 */
  petSmall: 64,
  icon32: 32,
  icon48: 48,
} as const;

export const COLORS = {
  bg: '#0d141a',
  panel: '#1b2a35',
  panelAlt: '#223643',
  border: '#0a1015',
  text: '#f2f4f8',
  textDim: '#9fb3c8',
  accent: '#f2c14e',
  good: '#5fd68a',
  danger: '#e05c5c',
  water: '#3f8fd2',
  thunder: '#e8c547',
  grass: '#5aa84f',
} as const;

export const FONT_SIZE = {
  title: 48,
  heading: 32,
  body: 26,
  small: 20,
} as const;
