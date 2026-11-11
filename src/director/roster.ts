import { registry, type CharacterEntry } from '../characters/registry';

/**
 * A roster is plain data: character id -> level. Passed between scenes by value,
 * never as live objects, so every battle (and retry) starts clean.
 */
export type Roster = Readonly<Record<string, number>>;

/** Default roster when nothing else is given. */
export const DEFAULT_ROSTER: Roster = { prism: 1 };

export function clampLevel(level: number, entry: CharacterEntry): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(entry.maxLevel, Math.floor(level)));
}

/** Copy containing every registered character (missing = 0), clamped. */
export function normalizeRoster(r: Partial<Record<string, number>> | undefined, entries: readonly CharacterEntry[] = registry): Roster {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.id] = clampLevel(r?.[e.id] ?? 0, e);
  return out;
}

export function totalLevel(r: Roster): number {
  return Object.values(r).reduce((s, l) => s + l, 0);
}

/**
 * Parse the dev shortcut `?roster=prism:12,other:3`. Unknown ids and malformed
 * pairs are ignored; levels are clamped. Returns null when nothing usable is present.
 */
export function parseRosterParam(value: string | null, entries: readonly CharacterEntry[] = registry): Roster | null {
  if (!value) return null;
  const levels: Record<string, number> = {};
  let any = false;
  for (const pair of value.split(',')) {
    const [id, lv] = pair.split(':').map((s) => s.trim());
    const entry = entries.find((e) => e.id === id);
    const n = Number.parseInt(lv ?? '', 10);
    if (!entry || !Number.isFinite(n)) continue;
    levels[entry.id] = n;
    any = true;
  }
  return any ? normalizeRoster(levels, entries) : null;
}
