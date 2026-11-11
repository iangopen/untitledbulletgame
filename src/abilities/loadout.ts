import type { ActiveAbility } from './Ability';
import { Dash } from './actives/Dash';

/**
 * The equipped abilities: one active slot, one passive slot. Plain data (ids), so the Phase 8 shop
 * can swap them and battles copy it like the roster. Stored under its own key, separate from
 * settings (and from Phase 8 progress).
 */
export interface Loadout {
  active: string | null;
  passive: string | null;
}

export const LOADOUT_VERSION = 1;
export const LOADOUT_KEY = `ubg.loadout.v${LOADOUT_VERSION}`;

/** Active abilities by id. Add new actives here. */
export const ACTIVES: Record<string, () => ActiveAbility> = {
  dash: () => new Dash(),
};
/** Passive abilities by id (none yet). */
export const PASSIVES: Record<string, () => unknown> = {};

export const DEFAULT_LOADOUT: Readonly<Loadout> = Object.freeze({ active: 'dash', passive: null });

/** A fresh ability instance for the equipped active, or null. */
export function createActive(loadout: Loadout): ActiveAbility | null {
  const make = loadout.active ? ACTIVES[loadout.active] : undefined;
  return make ? make() : null;
}

/** Field by field: unknown ids, wrong version or corrupt data give the default. */
export function parseLoadout(raw: string | null | undefined): Loadout {
  const out: Loadout = { ...DEFAULT_LOADOUT };
  if (!raw) return out;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!d || typeof d !== 'object' || (d as { v?: unknown }).v !== LOADOUT_VERSION) return out;
  const r = d as Record<string, unknown>;
  if (r.active === null || (typeof r.active === 'string' && r.active in ACTIVES)) out.active = r.active;
  if (r.passive === null || (typeof r.passive === 'string' && r.passive in PASSIVES)) out.passive = r.passive;
  return out;
}

export function serializeLoadout(l: Loadout): string {
  return JSON.stringify({ v: LOADOUT_VERSION, active: l.active, passive: l.passive });
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Never throws. */
export function loadLoadout(storage: Store | null | undefined): Loadout {
  try {
    return parseLoadout(storage?.getItem(LOADOUT_KEY));
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

/** Never throws; false if storage is unavailable. */
export function saveLoadout(storage: Store | null | undefined, l: Loadout): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LOADOUT_KEY, serializeLoadout(l));
    return true;
  } catch {
    return false;
  }
}

/** The browser's localStorage, or null when blocked. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
