/**
 * Palette. All colors in the game come from here.
 * Style: near-black background, flat bright solid shapes, crisp edges, no textures.
 * Hazards never use red (red is the player). Generic hazards are white; KR is magenta.
 */
export const theme = {
  background: 0x08080d,
  boxBorder: 0xf4f4f8,
  boxFill: 0x000000,
  soul: 0xff2a4a,
  hitFlash: 0xff2a4a,
  text: 0xf4f4f8,
  textDim: 0x7c7c8c,
  hpFill: 0xf5e663,
  hpEmpty: 0x2a2a36,
  kr: 0xff2bd6,
  bulletNormal: 0xf4f4f8,
  bulletKr: 0xff2bd6,
  /** Character accent colors (one per character; never red). */
  prism: 0x3de8ff,
  /** Non-damaging props (e.g. refraction prism) draw as translucent fill + outline. */
  propFillAlpha: 0.18,
  /** UI */
  locked: 0x3a3a4a,
  panel: 0x111119,
  win: 0x6dff9e,
  loss: 0xff2a4a,
  /** Dev hitbox overlay. */
  hitboxOutline: 0x39ff88,
} as const;

export const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
export const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Typography: clean sans for titles/labels, mono for numbers. */
export const fonts = {
  sans: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'Consolas, "SF Mono", Menlo, monospace',
} as const;
