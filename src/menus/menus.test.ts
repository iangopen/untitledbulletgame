import { describe, expect, it } from 'vitest';
import { registry } from '../characters/registry';
import { GRID_SLOTS, buildGrid, changeSlotLevel, moveInGrid, setAllLevels } from './grid';
import { cycleOption, pickAndSave } from './loadoutPick';
import { DEFAULT_LOADOUT, loadLoadout } from '../abilities/loadout';
import { lastRoster, normalizeRoster, parseRosterParam, rememberRoster } from '../director/roster';
import { attacksOf } from '../characters/registry';

describe('Custom grid', () => {
  const grid = buildGrid();
  it('is the 5 registered characters in order, then 45 placeholders', () => {
    expect(grid).toHaveLength(50);
    expect(GRID_SLOTS).toBe(50);
    expect(grid.slice(0, 5).map((s) => s.entry?.id)).toEqual(['prism', 'mortimer', 'ulysses', 'warden', 'ember']);
    expect(grid.slice(5).every((s) => s.entry === null && s.title === '???' && s.description === 'Coming soon.')).toBe(true);
    expect(grid.filter((s) => s.entry)).toHaveLength(registry.length);
  });
  it('takes names and descriptions from each config', () => {
    expect(grid[0]!.description).toBe('Splits light into something far less friendly.');
    expect(grid[1]!.title).toBe('Mortimer G. Frostwick Jr.');
    expect(grid[1]!.description).toBe('Prefers you hold very, very still.');
    expect(grid[2]!.title).toBe('Prince Ulysses');
    expect(grid[2]!.description).toBe('Gold means wait. White means run.');
    expect(grid[3]!.description).toBe('Never lays a finger on you. Just everything around you.');
    expect(grid[4]!.description).toBe('Standing still is how you get burned.');
  });
  it('grows with the registry: a new character takes the next slot', () => {
    const extra = { ...registry[0]!, id: 'new', config: { ...registry[0]!.config, title: 'New', description: 'd' } };
    const g = buildGrid([...registry, extra]);
    expect(g).toHaveLength(50);
    expect(g[5]!.entry?.id).toBe('new');
    expect(g[5]!.title).toBe('New');
    expect(g.filter((s) => !s.entry)).toHaveLength(44);
  });
  it('clamps levels to 0-20 and locks placeholders', () => {
    const r = normalizeRoster({ prism: 19 });
    const up = changeSlotLevel(r, grid[0]!, 1)!;
    expect(up.prism).toBe(20);
    expect(changeSlotLevel(up, grid[0]!, 1)).toBeNull();
    expect(changeSlotLevel(r, grid[1]!, -1)).toBeNull();
    expect(changeSlotLevel(r, grid[1]!, 25)!.mortimer).toBe(20);
    for (const s of grid.slice(5)) expect(changeSlotLevel(r, s, 1)).toBeNull();
  });
  it('sets all real characters to 0 or 20', () => {
    expect(setAllLevels(grid, 20)).toEqual({ prism: 20, mortimer: 20, ulysses: 20, warden: 20, ember: 20 });
    expect(Object.values(setAllLevels(grid, 0))).toEqual([0, 0, 0, 0, 0]);
    expect(setAllLevels(grid, 99).prism).toBe(20);
  });
  it('moves in 2D and wraps', () => {
    expect(moveInGrid(0, -1, 0)).toBe(9);
    expect(moveInGrid(0, 0, -1)).toBe(40);
    expect(moveInGrid(9, 1, 0)).toBe(0);
    expect(moveInGrid(4, 0, 1)).toBe(14);
  });
  it('remembers the ?roster= levels for the grid', () => {
    rememberRoster(parseRosterParam('prism:12,ember:3')!);
    expect(lastRoster()).toMatchObject({ prism: 12, ember: 3, mortimer: 0 });
  });
});

describe('Debug sandbox attack lists', () => {
  it('lists every attack with its unlock level', () => {
    expect(attacksOf(registry[0]!)).toEqual([{ id: 'volley', from: 1 }, { id: 'beam', from: 1 }, { id: 'prism', from: 1 }]);
    expect(attacksOf(registry[3]!).map((a) => `${a.id}@${a.from}`)).toEqual(['punch@1', 'toss@6', 'rip@15']);
  });
});

describe('Player screen loadout', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('saves a pick at once and reads it back', () => {
    const s = mem();
    let l = { ...DEFAULT_LOADOUT };
    l = pickAndSave(s, l, 'active', 3); // blink
    l = pickAndSave(s, l, 'passive', 3); // steady
    expect(loadLoadout(s)).toEqual({ active: 'blink', passive: 'steady' });
    l = pickAndSave(s, l, 'active', 4); // none
    expect(loadLoadout(s)).toEqual({ active: null, passive: 'steady' });
  });
  it('cycles with wrap', () => {
    expect(cycleOption({ active: 'dash', passive: null }, 'active', -1).active).toBe(null);
    expect(cycleOption({ active: 'dash', passive: null }, 'passive', 1).passive).toBe('thickSkin');
  });
});
