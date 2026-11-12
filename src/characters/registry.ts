import type { World } from '../core/World';
import type { CharacterHandle } from './Character';
import { Prism } from './prism/Prism';
import { prismConfig } from './prism/prism.config';
import { Mortimer } from './mortimer/Mortimer';
import { mortimerConfig } from './mortimer/mortimer.config';
import { Ulysses } from './ulysses/Ulysses';
import { ulyssesConfig } from './ulysses/ulysses.config';
import { Warden } from './warden/Warden';
import { wardenConfig } from './warden/warden.config';
import { theme } from '../render/theme';

export interface CharacterEntry {
  id: string;
  name: string;
  color: number;
  maxLevel: number;
  /** Shape drawn for this character on the roster screen. */
  shape: 'triangle' | 'circle' | 'square' | 'snowman' | 'shield' | 'golem';
  create: (world: World) => CharacterHandle;
}

/** All characters by id. Adding a character = add its folder + one entry here. */
export const registry: readonly CharacterEntry[] = [
  { id: 'prism', name: 'Prism', color: theme.prism, maxLevel: prismConfig.maxLevel, shape: 'triangle', create: (w) => new Prism(w) },
  { id: 'mortimer', name: 'Mortimer', color: theme.mortimer, maxLevel: mortimerConfig.maxLevel, shape: 'snowman', create: (w) => new Mortimer(w, 2) },
  { id: 'ulysses', name: 'Ulysses', color: theme.ulysses, maxLevel: ulyssesConfig.maxLevel, shape: 'shield', create: (w) => new Ulysses(w, 3) },
  { id: 'warden', name: 'The Warden', color: theme.warden, maxLevel: wardenConfig.maxLevel, shape: 'golem', create: (w) => new Warden(w, 4) },
];

export const characterById = (id: string): CharacterEntry | undefined => registry.find((c) => c.id === id);

/** Roster screen slots (UCN-style row). Real characters first, then locked placeholders. */
export const ROSTER_SLOTS = 5;
