import { describe, expect, it } from 'vitest';
import { registry } from '../characters/registry';
import { GRID_SLOTS, addAllLevels, pointValue, buildGrid, changeSlotLevel, moveInGrid, setAllLevels } from './grid';
import { cycleOption, pickAndSave } from './loadoutPick';
import { DEFAULT_LOADOUT, loadLoadout } from '../abilities/loadout';
import { lastRoster, normalizeRoster, parseRosterParam, rememberRoster } from '../director/roster';
import { attacksOf } from '../characters/registry';

describe('Custom grid', () => {
  const grid = buildGrid();
  it('is the 9 registered characters in order, then 41 placeholders', () => {
    expect(grid).toHaveLength(50);
    expect(GRID_SLOTS).toBe(50);
    expect(grid.slice(0, 9).map((s) => s.entry?.id)).toEqual(['rose', 'prism', 'mortimer', 'ulysses', 'warden', 'ember', 'volt', 'vesper', 'nightshade']);
    expect(grid.slice(9).every((s) => s.entry === null && s.title === '???' && s.description === 'Coming soon.')).toBe(true);
    expect(grid.filter((s) => s.entry)).toHaveLength(registry.length);
  });
  it('takes names and descriptions from each config', () => {
    expect(grid[0]!.title).toBe('Rose');
    expect(grid[0]!.description).toBe('Every rose has its thorns. She has several thousand.');
    expect(grid[1]!.description).toBe('Splits light into something far less friendly.');
    expect(grid[2]!.title).toBe('Mortimer G. Frostwick Jr.');
    expect(grid[2]!.description).toBe('Prefers you hold very, very still.');
    expect(grid[3]!.title).toBe('Prince Ulysses');
    expect(grid[3]!.description).toBe('Gold means wait. White means run.');
    expect(grid[4]!.description).toBe('Never lays a finger on you. Just everything around you.');
    expect(grid[5]!.description).toBe('Standing still is how you get burned.');
    expect(grid[8]!.description).toBe('Beautiful. Poisonous. Patient.');
    expect(grid[7]!.title).toBe('Vesper');
    expect(grid[6]!.title).toBe('Volt');
    expect(grid[6]!.description).toBe('He never strikes the same place twice. He doesn\u2019t need to.');
  });
  it('grows with the registry: a new character takes the next slot', () => {
    const extra = { ...registry[0]!, id: 'new', config: { ...registry[0]!.config, title: 'New', description: 'd' } };
    const g = buildGrid([...registry, extra]);
    expect(g).toHaveLength(50);
    expect(g[9]!.entry?.id).toBe('new');
    expect(g[9]!.title).toBe('New');
    expect(g.filter((s) => !s.entry)).toHaveLength(40);
  });
  it('clamps levels to 0-20 and locks placeholders', () => {
    const r = normalizeRoster({ prism: 19 });
    const up = changeSlotLevel(r, grid[1]!, 1)!;
    expect(up.prism).toBe(20);
    expect(changeSlotLevel(up, grid[1]!, 1)).toBeNull();
    expect(changeSlotLevel(r, grid[2]!, -1)).toBeNull();
    expect(changeSlotLevel(r, grid[2]!, 25)!.mortimer).toBe(20);
    for (const s of grid.slice(9)) expect(changeSlotLevel(r, s, 1)).toBeNull();
  });
  it('sets all real characters to 0 or 20', () => {
    expect(setAllLevels(grid, 20)).toEqual({ rose: 20, prism: 20, mortimer: 20, ulysses: 20, warden: 20, ember: 20, volt: 20, vesper: 20, nightshade: 20 });
    expect(Object.values(setAllLevels(grid, 0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(setAllLevels(grid, 99).prism).toBe(20);
  });
  it('adds one to every real character, clamping at 20', () => {
    const r = addAllLevels(normalizeRoster({ prism: 19, mortimer: 20, ulysses: 0, warden: 5 }), grid, 1);
    expect(r).toEqual({ rose: 1, prism: 20, mortimer: 20, ulysses: 1, warden: 6, ember: 1, volt: 1, vesper: 1, nightshade: 1 });
    expect(addAllLevels(r, grid, 1)).toMatchObject({ prism: 20, mortimer: 20, ulysses: 2 });
    let all = normalizeRoster({});
    for (let i = 0; i < 25; i++) all = addAllLevels(all, grid, 1);
    expect(Object.values(all)).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 20]);
  });
  it('point value is the level sum times 10', () => {
    expect(pointValue(normalizeRoster({}))).toBe(0);
    expect(pointValue(normalizeRoster({ prism: 3, ember: 7 }))).toBe(100);
    expect(pointValue(setAllLevels(grid, 20))).toBe(1800);
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
    expect(attacksOf(registry[0]!).map((a) => `${a.id}@${a.from}`)).toEqual(['volley@1', 'vine@6', 'bloom@15']);
    expect(attacksOf(registry[1]!).map((a) => `${a.id}@${a.from}`)).toEqual(['beam@1', 'prism@1', 'mirrors@6', 'blaster@15']);
    expect(attacksOf(registry[4]!).map((a) => `${a.id}@${a.from}`)).toEqual(['punch@1', 'toss@6', 'rip@15']);
    expect(attacksOf(registry[6]!).map((a) => `${a.id}@${a.from}`)).toEqual(['strike@1', 'fork@6', 'storm@15']);
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
