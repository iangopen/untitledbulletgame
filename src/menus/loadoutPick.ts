import { ACTIVE_INFO, PASSIVE_INFO, saveLoadout, type AbilityInfo, type Loadout } from '../abilities/loadout';

export type LoadoutSlot = 'active' | 'passive';

/** Options the Player screen offers per slot (every ability unlocked until the shop exists). */
export const SLOT_OPTIONS: Readonly<Record<LoadoutSlot, readonly AbilityInfo[]>> = { active: ACTIVE_INFO, passive: PASSIVE_INFO };

/** Equip option i of a slot. Returns the same object when nothing changed. */
export function equipOption(l: Loadout, slot: LoadoutSlot, i: number): Loadout {
  const a = SLOT_OPTIONS[slot][i];
  if (!a || l[slot] === a.id) return l;
  return { ...l, [slot]: a.id };
}

/** Equip the previous / next option of a slot (wrapping). */
export function cycleOption(l: Loadout, slot: LoadoutSlot, d: number): Loadout {
  const list = SLOT_OPTIONS[slot];
  const cur = Math.max(0, list.findIndex((a) => a.id === l[slot]));
  return equipOption(l, slot, (cur + d + list.length) % list.length);
}

/** The Player screen's change: equip and save at once (storage never throws). */
export function pickAndSave(storage: Pick<Storage, 'getItem' | 'setItem'> | null, l: Loadout, slot: LoadoutSlot, i: number): Loadout {
  const next = equipOption(l, slot, i);
  if (next !== l) saveLoadout(storage, next);
  return next;
}
