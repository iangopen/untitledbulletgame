import type { ActiveAbility } from './Ability';
import type { World } from '../core/World';
import { Dash } from './actives/Dash';
import { Shield } from './actives/Shield';
import { SlowTime } from './actives/SlowTime';
import { Blink } from './actives/Blink';
import { PASSIVE_LIST, type Passive } from './passives/passives';

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
  shield: () => new Shield(),
  slow: () => new SlowTime(),
  blink: () => new Blink(),
};
/** Passive abilities by id. Add new passives to passives/passives.ts. */
export const PASSIVES: Record<string, Passive> = Object.fromEntries(PASSIVE_LIST.map((p) => [p.id, p]));

/** Picker entry: id (null = none), shown name and one-line description. Every ability is unlocked for now (no shop yet). */
export interface AbilityInfo {
  id: string | null;
  name: string;
  desc: string;
}
export const ACTIVE_INFO: readonly AbilityInfo[] = [
  { id: 'dash', name: 'dash', desc: 'a quick burst of movement with brief invulnerability' },
  { id: 'shield', name: 'shield', desc: 'a bubble that blocks the next hit, then breaks' },
  { id: 'slow', name: 'slow time', desc: 'everything but you slows down for a moment' },
  { id: 'blink', name: 'blink', desc: 'teleport a short way in the direction you hold' },
  { id: null, name: 'none', desc: 'no active ability' },
];
export const PASSIVE_INFO: readonly AbilityInfo[] = [
  { id: 'thickSkin', name: 'thick skin', desc: '25% more max hp' },
  { id: 'afterglow', name: 'afterglow', desc: 'longer invulnerability after a hit' },
  { id: 'quickCharge', name: 'quick charge', desc: 'your active recharges faster' },
  { id: 'steady', name: 'steady', desc: 'slow movement is a little faster' },
  { id: null, name: 'none', desc: 'no passive ability' },
];

/** Display name of an equipped id ('none' for null or unknown). */
export function abilityName(id: string | null, list: readonly AbilityInfo[]): string {
  return list.find((a) => a.id === id)?.name ?? 'none';
}

/**
 * THE battle-start hook: equips the loadout's active into the world, then applies its passive once.
 * Battle code calls only this, so new actives and passives plug in through the registries above.
 */
export function equipLoadout(world: World, loadout: Loadout): void {
  world.ability = createActive(loadout);
  const p = loadout.passive ? PASSIVES[loadout.passive] : undefined;
  p?.apply(world);
}

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
