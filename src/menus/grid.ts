import { registry, type CharacterEntry } from '../characters/registry';
import { clampLevel, type Roster } from '../director/roster';

/** The Custom screen's UCN-style portrait grid: 10 columns by 5 rows. */
export const GRID_COLS = 10;
export const GRID_ROWS = 5;
export const GRID_SLOTS = GRID_COLS * GRID_ROWS;

/** Info panel text for a slot with no character yet. */
export const PLACEHOLDER_INFO = { title: '???', description: 'Coming soon.' } as const;

export interface GridSlot {
  index: number;
  /** null = placeholder portrait (no character, level locked at 0). */
  entry: CharacterEntry | null;
  /** Info panel text: the character's full name and its config's description. */
  title: string;
  description: string;
}

/**
 * The grid is generated: every registered character in registry order, then placeholders up to
 * GRID_SLOTS. Adding a character only means registering it (title and description come from its config).
 */
export function buildGrid(entries: readonly CharacterEntry[] = registry, slots = GRID_SLOTS): GridSlot[] {
  return Array.from({ length: Math.max(slots, entries.length) }, (_, index) => {
    const entry = entries[index] ?? null;
    return entry
      ? { index, entry, title: entry.config.title, description: entry.config.description }
      : { index, entry: null, ...PLACEHOLDER_INFO };
  });
}

/**
 * Level change on a slot. Returns the new roster, or null when nothing can change: a placeholder
 * (locked), or a level already at its 0 / max limit.
 */
export function changeSlotLevel(levels: Roster, slot: GridSlot, delta: number): Roster | null {
  if (!slot.entry) return null;
  const id = slot.entry.id;
  const cur = levels[id] ?? 0;
  const next = clampLevel(cur + delta, slot.entry);
  return next === cur ? null : { ...levels, [id]: next };
}

/** Set every real character to `level` (clamped); placeholders have no level. */
export function setAllLevels(grid: readonly GridSlot[], level: number): Roster {
  const out: Record<string, number> = {};
  for (const s of grid) if (s.entry) out[s.entry.id] = clampLevel(level, s.entry);
  return out;
}

/** Keyboard move on the grid (wraps within the row / column). */
export function moveInGrid(index: number, dx: number, dy: number, cols = GRID_COLS, rows = GRID_ROWS): number {
  const c = ((((index % cols) + dx) % cols) + cols) % cols;
  const r = (((Math.floor(index / cols) + dy) % rows) + rows) % rows;
  return r * cols + c;
}
