/** Palette. All colors in the game come from here. */
export const theme = {
  background: 0x07070c,
  boxBorder: 0xffffff,
  boxFill: 0x000000,
  soul: 0xff2a4a,
  text: 0xffffff,
  textDim: 0x8a8a99,
  hpFill: 0xf5e663,
  hpEmpty: 0x3a1020,
  kr: 0xd040ff,
  /** Temporary test-bullet colors (Phase 1 spawner). */
  bulletNormal: 0xffffff,
  bulletKr: 0xd040ff,
} as const;

export const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
