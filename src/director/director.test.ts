import { describe, expect, it } from 'vitest';
import { Director } from './Director';
import { TimerMode, formatClock } from './modes/TimerMode';
import { installInteractions, type Interaction } from './interactions';
import { normalizeRoster, parseRosterParam, totalLevel } from './roster';
import { World } from '../core/World';
import { STEP } from '../core/Clock';
import { TIMER_DURATION } from '../tuning';
import type { CharacterEntry } from '../characters/registry';
import type { CharacterHandle } from '../characters/Character';

const still = { dx: 0, dy: 0, slow: false };

/** Fake character that counts ticks, so the Director can be tested in isolation. */
function fakeEntry(id: string, log: string[]): CharacterEntry {
  return {
    id, name: id, color: 0xffffff, maxLevel: 20, shape: 'circle',
    create: (): CharacterHandle => {
      log.push(`create ${id}`);
      const c = {
        id, color: 0, level: 0, ticks: 0,
        get active() { return c.level > 0; },
        setLevel(l: number) { c.level = l; },
        tick() { c.ticks++; },
        dispose() { log.push(`dispose ${id}`); },
      };
      return c;
    },
  };
}

describe('TimerMode', () => {
  const m = new TimerMode(10);
  it('continues while alive and before the target', () => expect(m.evaluate({ time: 9.99, soulAlive: true })).toBeNull());
  it('wins at the target time', () => expect(m.evaluate({ time: 10, soulAlive: true })).toBe('win'));
  it('loses at 0 HP, even on the final step', () => {
    expect(m.evaluate({ time: 3, soulAlive: false })).toBe('loss');
    expect(m.evaluate({ time: 10, soulAlive: false })).toBe('loss');
  });
  it('defaults to TIMER_DURATION (2 minutes)', () => {
    expect(new TimerMode().duration).toBe(TIMER_DURATION);
    expect(TIMER_DURATION).toBe(120);
  });
  it('formats the countdown rounding up', () => {
    expect(new TimerMode(120).hud({ time: 0, soulAlive: true })).toBe('2:00');
    expect(formatClock(59.01)).toBe('1:00');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(0.2)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
  });
});

describe('Director', () => {
  it('creates and ticks only characters above level 0', () => {
    const log: string[] = [];
    const entries = [fakeEntry('a', log), fakeEntry('b', log)];
    const d = new Director(new World(0, 0), { a: 3, b: 0 }, new TimerMode(10), entries);
    expect(d.characters.map((c) => c.id)).toEqual(['a']);
    expect(log).toEqual(['create a']);
    for (let i = 0; i < 30; i++) d.step(still, STEP);
    expect((d.characters[0] as unknown as { ticks: number }).ticks).toBe(30);
    d.dispose();
    expect(log).toContain('dispose a');
  });
  it('owns battle time and reports a win on timeout', () => {
    const d = new Director(new World(0, 0), { prism: 0 }, new TimerMode(1));
    for (let i = 0; i < 59; i++) d.step(still, STEP);
    expect(d.outcome).toBeNull();
    d.step(still, STEP);
    expect(d.outcome).toMatchObject({ result: 'win', mode: 'timer', hp: 100, maxHp: 100, roster: { prism: 0 } });
    expect(d.outcome!.time).toBeCloseTo(1);
  });
  it('reports a loss when HP reaches 0, with the time survived', () => {
    const w = new World(0, 0);
    const d = new Director(w, { prism: 5 }, new TimerMode(60));
    for (let i = 0; i < 30; i++) d.step(still, STEP);
    w.soul.damage({ amount: 999, type: 'normal' });
    d.step(still, STEP);
    expect(d.outcome).toMatchObject({ result: 'loss', hp: 0, roster: { prism: 5 } });
    expect(d.outcome!.time).toBeCloseTo(31 * STEP);
  });
  it('freezes after the outcome', () => {
    const d = new Director(new World(0, 0), {}, new TimerMode(0.5));
    for (let i = 0; i < 120; i++) d.step(still, STEP);
    expect(d.time).toBeCloseTo(0.5);
    expect(d.outcome!.time).toBeCloseTo(0.5);
  });
  it('the outcome roster is a copy, not the live input', () => {
    const input = { prism: 4 };
    const d = new Director(new World(0, 0), input, new TimerMode(STEP));
    d.step(still, STEP);
    input.prism = 9;
    expect(d.outcome!.roster.prism).toBe(4);
  });
  it('real Prism at level 0 spawns nothing through the Director', () => {
    const w = new World(0, 0);
    const d = new Director(w, { prism: 0 }, new TimerMode(30));
    for (let i = 0; i < 60 * 20; i++) d.step(still, STEP);
    expect(d.characters).toHaveLength(0);
    expect(w.pool.activeCount).toBe(0);
  });
});

describe('interactions', () => {
  it('installs only rules whose characters are all active, and disposes them', () => {
    const calls: string[] = [];
    const rule = (id: string, requires: string[]): Interaction => ({
      id, requires,
      install: (bus) => bus.on('beamFired', () => calls.push(id)),
    });
    const w = new World(0, 0);
    const off = installInteractions(w, new Set(['prism']), [rule('solo', ['prism']), rule('combo', ['prism', 'other'])]);
    w.bus.emit('beamFired', { owner: 'prism', x: 0, y: 0, angle: 0, gen: 0 });
    off();
    w.bus.emit('beamFired', { owner: 'prism', x: 0, y: 0, angle: 0, gen: 0 });
    expect(calls).toEqual(['solo']);
  });
});

describe('roster data', () => {
  it('parses ?roster=prism:12 and clamps / ignores junk', () => {
    expect(parseRosterParam('prism:12')).toEqual({ prism: 12 });
    expect(parseRosterParam('prism:99')).toEqual({ prism: 20 });
    expect(parseRosterParam('prism:-4,nobody:5')).toEqual({ prism: 0 });
    expect(parseRosterParam('nobody:5')).toBeNull();
    expect(parseRosterParam('prism')).toBeNull();
    expect(parseRosterParam(null)).toBeNull();
  });
  it('normalizes to every registered id and sums levels', () => {
    expect(normalizeRoster({})).toEqual({ prism: 0 });
    expect(totalLevel({ prism: 7 })).toBe(7);
  });
});
