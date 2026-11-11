import type { EventBus } from '../core/EventBus';
import type { World } from '../core/World';

/**
 * Cross-character combo rules live here and only here. Characters never know
 * about each other; a rule listens to bus events from some characters and
 * reacts (spawns, buffs, etc.). Empty until Phase 6.
 */
export interface Interaction {
  id: string;
  /** Character ids that must all be active for this rule to run. */
  requires: readonly string[];
  /** Subscribe to the bus; return an unsubscribe function. */
  install(bus: EventBus, world: World): () => void;
}

export const interactions: readonly Interaction[] = [];

/** Install every rule whose required characters are active. Returns one disposer for all. */
export function installInteractions(
  world: World,
  activeIds: ReadonlySet<string>,
  rules: readonly Interaction[] = interactions,
): () => void {
  const offs = rules.filter((r) => r.requires.every((id) => activeIds.has(id))).map((r) => r.install(world.bus, world));
  return () => offs.forEach((off) => off());
}
