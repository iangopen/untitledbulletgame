import type { World } from '../core/World';
import type { CharacterHandle } from './Character';
import { Rose } from './rose/Rose';
import { roseConfig } from './rose/rose.config';
import { Prism } from './prism/Prism';
import { prismConfig } from './prism/prism.config';
import { Mortimer } from './mortimer/Mortimer';
import { mortimerConfig } from './mortimer/mortimer.config';
import { Ulysses } from './ulysses/Ulysses';
import { ulyssesConfig } from './ulysses/ulysses.config';
import { Warden } from './warden/Warden';
import { wardenConfig } from './warden/warden.config';
import { Ember } from './ember/Ember';
import { Volt } from './volt/Volt';
import { Vesper } from './vesper/Vesper';
import { vesperConfig } from './vesper/vesper.config';
import { voltConfig } from './volt/volt.config';
import { emberConfig } from './ember/ember.config';
import { theme } from '../render/theme';
import { attackList, type CharacterConfig } from './config';

export interface CharacterEntry {
  id: string;
  name: string;
  color: number;
  maxLevel: number;
  /** Shape drawn for this character on the roster screen. */
  shape: 'triangle' | 'circle' | 'square' | 'snowman' | 'shield' | 'golem' | 'flame' | 'rose' | 'bolt' | 'dagger';
  create: (world: World) => CharacterHandle;
  /** The character's data file (title, description, bands); the menus read from it. */
  config: CharacterConfig<string, unknown>;
}

/** All characters by id. Adding a character = add its folder + one entry here. */
export const registry: readonly CharacterEntry[] = [
  { id: 'rose', name: 'Rose', color: theme.rose, maxLevel: roseConfig.maxLevel, shape: 'rose', create: (w) => new Rose(w, 6), config: roseConfig },
  { id: 'prism', name: 'Prism', color: theme.prism, maxLevel: prismConfig.maxLevel, shape: 'triangle', create: (w) => new Prism(w), config: prismConfig },
  { id: 'mortimer', name: 'Mortimer', color: theme.mortimer, maxLevel: mortimerConfig.maxLevel, shape: 'snowman', create: (w) => new Mortimer(w, 2), config: mortimerConfig },
  { id: 'ulysses', name: 'Ulysses', color: theme.ulysses, maxLevel: ulyssesConfig.maxLevel, shape: 'shield', create: (w) => new Ulysses(w, 3), config: ulyssesConfig },
  { id: 'warden', name: 'The Warden', color: theme.warden, maxLevel: wardenConfig.maxLevel, shape: 'golem', create: (w) => new Warden(w, 4), config: wardenConfig },
  { id: 'ember', name: 'Ember', color: theme.ember, maxLevel: emberConfig.maxLevel, shape: 'flame', create: (w) => new Ember(w, 5), config: emberConfig },
  { id: 'volt', name: 'Volt', color: theme.volt, maxLevel: voltConfig.maxLevel, shape: 'bolt', create: (w) => new Volt(w, 7), config: voltConfig },
  { id: 'vesper', name: 'Vesper', color: theme.vesper, maxLevel: vesperConfig.maxLevel, shape: 'dagger', create: (w) => new Vesper(w, 8), config: vesperConfig },
];

export const characterById = (id: string): CharacterEntry | undefined => registry.find((c) => c.id === id);

/** Every attack of a character with the level it unlocks at (Debug sandbox). */
export const attacksOf = (e: CharacterEntry) => attackList(e.config);
