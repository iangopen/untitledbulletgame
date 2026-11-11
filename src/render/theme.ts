/**
 * Palette and the UI scale. All colors, font sizes, spacing and line weights come from here.
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
  /** Secondary text (unselected items, values). */
  textDim: 0x8a8a9a,
  /** Quiet text (hints, captions). */
  textMuted: 0x4a4a58,
  hpFill: 0xf5e663,
  hpEmpty: 0x22222c,
  kr: 0xff2bd6,
  /** Projectile colors, one per type (combat/projectile.ts). Never red; fixed for every character. */
  bullet: {
    white: 0xf4f4f8,
    blue: 0x2e8bff,
    orange: 0xff8a1c,
    kr: 0xff2bd6,
  },
  /** Character accent colors (one per character; never red). */
  prism: 0x3de8ff,
  /** Non-damaging props (e.g. refraction prism) draw as translucent fill + outline. */
  propFillAlpha: 0.18,
  /** Damaging wall (normal damage). Amber: distinct from white walls, never red. KR walls use `kr`. */
  wallDamaging: 0xffb020,
  /** UI */
  locked: 0x2e2e3a,
  rule: 0x22222c,
  win: 0x6dff9e,
  loss: 0xff2a4a,
  /** Dev hitbox overlay. */
  hitboxOutline: 0x39ff88,
} as const;

export const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
export const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** Virtual view: every scene lays out in these coordinates, whatever the window or DPI. */
export const VIEW = { width: 1280, height: 720, cx: 640, cy: 360 } as const;

/** One UI typeface (Inter, self-hosted) and a mono (JetBrains Mono) for numbers only. */
export const fonts = {
  sans: 'Inter, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", Consolas, Menlo, monospace',
} as const;

/** Font sizes (px in the virtual view). */
export const type = {
  hint: 15,
  small: 17,
  body: 22,
  label: 26,
  number: 44,
  title: 64,
} as const;

/** Spacing scale (px). */
export const space = {
  xs: 6,
  sm: 12,
  md: 24,
  lg: 48,
  xl: 96,
} as const;

/** Line weights (px). Even widths on integer coordinates stay sharp at any whole-number zoom. */
export const line = {
  /** Underlines, rules, outlines. */
  thin: 2,
  /** Safe box walls. */
  box: 2,
  /** Damaging walls. */
  danger: 6,
} as const;
