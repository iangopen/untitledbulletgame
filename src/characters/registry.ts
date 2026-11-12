import type { World } from '../core/World';
import type { CharacterHandle } from './Character';
import { Prism } from './prism/Prism';
import { prismConfig } from './prism/prism.config';
import { Mortimer } from './mortimer/Mortimer';
import { mortimerConfig } from './mortimer/mortimer.config';
import { theme } from '../render/theme';

export interface CharacterEntry {
  id: string;
  name: string;
  color: number;
  maxLevel: number;
  /** Shape drawn for this character on the roster screen. */
  shape: 'triangle' | 'circle' | 'square' | 'snowman';
  create: (world: World) => CharacterHandle;
}

/** All characters by id. Adding a character = add its folder + one entry here. */
export const registry: readonly CharacterEntry[] = [
  { id: 'prism', name: 'Prism', color: theme.prism, maxLevel: prismConfig.maxLevel, shape: 'triangle', create: (w) => new Prism(w) },
  { id: 'mortimer', name: 'Mortimer', color: theme.mortimer, maxLevel: mortimerConfig.maxLevel, shape: 'snowman', create: (w) => new Mortimer(w, 2) },
];

export const characterById = (id: string): CharacterEntry | undefined => registry.find((c) => c.id === id);

/** Roster screen slots (UCN-style row). Real characters first, then locked placeholders. */
export const ROSTER_SLOTS = 5;
