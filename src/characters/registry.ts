import type { World } from '../core/World';
import type { CharacterHandle } from './Character';
import { Prism } from './prism/Prism';
import { theme } from '../render/theme';

export interface CharacterEntry {
  id: string;
  name: string;
  color: number;
  create: (world: World) => CharacterHandle;
}

/** All characters by id. Adding a character = add its folder + one entry here. */
export const registry: readonly CharacterEntry[] = [
  { id: 'prism', name: 'Prism', color: theme.prism, create: (w) => new Prism(w) },
];

export const characterById = (id: string): CharacterEntry | undefined => registry.find((c) => c.id === id);
