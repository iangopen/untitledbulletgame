/**
 * Player settings: plain data, pure parse/serialise (no DOM). Settings only change how and how often
 * the game is drawn, never the simulation (fixed 60 Hz step), so they can't affect difficulty,
 * timing or hitboxes.
 *
 * Storage: its own versioned localStorage key, separate from game progress (Phase 8 adds that).
 * Anything missing, unknown or corrupt falls back to the default, field by field.
 */
export type Quality = 'full' | 'balanced' | 'performance';
export const QUALITIES: readonly Quality[] = ['full', 'balanced', 'performance'];

export interface Settings {
  /** Draw on every Nth display tick (1 = match display). Applied as min(this, what the display allows). */
  frameDivisor: number;
  quality: Quality;
  /** Keep the F3 performance overlay on. */
  showFps: boolean;
  shake: boolean;
  flash: boolean;
  /** Custom screen: show the character name / description panel (Char info toggle). UI only. */
  charInfo: boolean;
}

export const SETTINGS_VERSION = 1;
export const SETTINGS_KEY = `ubg.settings.v${SETTINGS_VERSION}`;
export const MAX_DIVISOR = 4;

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  frameDivisor: 1,
  quality: 'full',
  showFps: false,
  shake: true,
  flash: true,
  charInfo: true,
});

/** Backing-store cap (x CSS size) per quality; Full follows devicePixelRatio. */
export function qualityCap(q: Quality): number {
  return q === 'performance' ? 1 : q === 'balanced' ? 1.5 : Infinity;
}

export function parseSettings(raw: string | null | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object' || (data as { v?: unknown }).v !== SETTINGS_VERSION) return out;
  const d = data as Record<string, unknown>;
  if (Number.isInteger(d.frameDivisor) && (d.frameDivisor as number) >= 1 && (d.frameDivisor as number) <= MAX_DIVISOR) {
    out.frameDivisor = d.frameDivisor as number;
  }
  if (QUALITIES.includes(d.quality as Quality)) out.quality = d.quality as Quality;
  for (const k of ['showFps', 'shake', 'flash', 'charInfo'] as const) if (typeof d[k] === 'boolean') out[k] = d[k];
  return out;
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify({ v: SETTINGS_VERSION, ...s });
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Never throws: blocked or missing storage gives defaults. */
export function loadSettings(storage: Store | null | undefined): Settings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Never throws; returns false if storage is unavailable or full. */
export function saveSettings(storage: Store | null | undefined, s: Settings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, serializeSettings(s));
    return true;
  } catch {
    return false;
  }
}
