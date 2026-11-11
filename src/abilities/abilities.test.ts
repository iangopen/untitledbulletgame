import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { STEP } from '../core/Clock';
import { Dash } from './actives/Dash';
import { DEFAULT_LOADOUT, LOADOUT_KEY, createActive, loadLoadout, parseLoadout, saveLoadout, serializeLoadout } from './loadout';
import { SETTINGS_KEY } from '../settings/settings';
import { BOX_WIDTH, DASH_COOLDOWN, DASH_DISTANCE, DASH_DURATION, DASH_IFRAMES } from '../tuning';
import { SNAP_DISTANCE } from '../render/interp';

const STILL = { dx: 0, dy: 0, slow: false };
const RIGHT = { dx: 1, dy: 0, slow: false };
const LEFT = { dx: -1, dy: 0, slow: false };
const press = (i: typeof STILL) => ({ ...i, ability: true });
const DASH_STEPS = Math.ceil(DASH_DURATION / STEP - 1e-9);

function world() {
  const w = new World(640, 360);
  w.ability = new Dash();
  return w;
}

describe('dash', () => {
  it('is a third of the default box width, over its duration', () => {
    expect(DASH_DISTANCE).toBeCloseTo(BOX_WIDTH / 3);
    const w = world();
    w.soul.pos.x = -100;
    const events: string[] = [];
    w.bus.on('abilityUsed', (e) => events.push(e.id));
    w.step(press(STILL), STEP);
    expect(events).toEqual([]); // no direction: nothing
    w.step(press(RIGHT), STEP);
    expect(events).toEqual(['dash']);
    for (let i = 1; i < DASH_STEPS; i++) {
      expect(w.ability!.active).toBe(true);
      w.step(STILL, STEP);
    }
    expect(w.ability!.active).toBe(false);
    expect(w.soul.pos.x).toBeCloseTo(-100 + DASH_DISTANCE, 6);
    w.step(STILL, STEP);
    expect(w.soul.pos.x).toBeCloseTo(-100 + DASH_DISTANCE, 6); // stopped
  });

  it('diagonals cover the same distance', () => {
    const w = world();
    w.step(press({ dx: 1, dy: 1, slow: false }), STEP);
    for (let i = 1; i < DASH_STEPS; i++) w.step(STILL, STEP);
    expect(Math.hypot(w.soul.pos.x, w.soul.pos.y)).toBeCloseTo(DASH_DISTANCE, 6);
  });

  it('no direction held: nothing happens and nothing is spent', () => {
    const w = world();
    w.step(press(STILL), STEP);
    expect(w.ability!.ready).toBe(true);
    expect(w.ability!.active).toBe(false);
    expect(w.soul.iframes).toBe(0);
    expect(w.soul.pos.x).toBe(0);
  });

  it('cooldown: not ready for DASH_COOLDOWN seconds; presses meanwhile are denied with no effect', () => {
    const w = world();
    const denied: number[] = [];
    w.bus.on('abilityDenied', (e) => denied.push(e.remaining));
    w.step(press(RIGHT), STEP);
    for (let i = 0; i < 60; i++) w.step(STILL, STEP);
    const x = w.soul.pos.x;
    w.step(press(LEFT), STEP);
    expect(denied.length).toBe(1);
    expect(w.ability!.active).toBe(false);
    expect(w.soul.pos.x).toBeLessThan(x); // normal walking only
    expect(x - w.soul.pos.x).toBeLessThan(10);
    // Ready exactly after the cooldown (in steps).
    let steps = 62;
    while (!w.ability!.ready) {
      w.step(STILL, STEP);
      steps++;
    }
    expect(steps * STEP).toBeCloseTo(DASH_COOLDOWN, 1);
    expect(DASH_COOLDOWN).toBe(3);
    w.step(press(LEFT), STEP);
    expect(w.ability!.active).toBe(true);
  });

  it('grants i-frames for its duration: a dash through a bullet takes no damage', () => {
    expect(DASH_IFRAMES).toBe(DASH_DURATION);
    const w = world();
    w.soul.pos.x = -60;
    // A wide stationary white bar in the dash path.
    w.pool.spawn({ shape: 'rect', x: 0, y: 0, a: 20, b: 200, damage: 10, noPop: true });
    w.step(press(RIGHT), STEP);
    expect(w.soul.iframes).toBeGreaterThan(0);
    for (let i = 1; i < DASH_STEPS; i++) w.step(STILL, STEP);
    expect(w.soul.pos.x).toBeCloseTo(-60 + DASH_DISTANCE, 6);
    expect(w.soul.hp).toBe(w.soul.maxHp);
    // Without a dash, walking into it hurts.
    const w2 = world();
    w2.soul.pos.x = -20;
    w2.pool.spawn({ shape: 'rect', x: 0, y: 0, a: 20, b: 200, damage: 10, noPop: true });
    for (let i = 0; i < 20; i++) w2.step(RIGHT, STEP);
    expect(w2.soul.hp).toBe(w2.soul.maxHp - 10);
  });

  it('never shortens running i-frames', () => {
    const w = world();
    w.soul.iframes = 0.8;
    w.step(press(RIGHT), STEP);
    expect(w.soul.iframes).toBeCloseTo(0.8 - STEP, 9);
  });

  it('stops at the wall (box clamp)', () => {
    const w = world();
    const edge = w.box.halfWidth - w.soul.hitRadius;
    w.soul.pos.x = edge - 30;
    w.step(press(RIGHT), STEP);
    for (let i = 1; i < DASH_STEPS + 2; i++) {
      w.step(STILL, STEP);
      expect(w.soul.pos.x).toBeLessThanOrEqual(edge + 1e-9);
    }
    expect(w.soul.pos.x).toBeCloseTo(edge, 9);
  });

  it('a wall squeezing in during a dash still pushes the soul inside', () => {
    const w = world();
    w.soul.pos.x = 0;
    w.step(press(RIGHT), STEP);
    w.box.squeezeWall('right', 300, 0.05, 'linear');
    for (let i = 0; i < DASH_STEPS + 6; i++) {
      w.step(STILL, STEP);
      expect(w.soul.pos.x).toBeLessThanOrEqual(w.box.halfWidth - w.soul.hitRadius + 1e-9);
      expect(w.soul.pos.x).toBeGreaterThanOrEqual(-w.box.halfWidth + w.soul.hitRadius - 1e-9);
    }
  });

  it('is screen-relative in a rotated box, like walking', () => {
    const w = world();
    w.box.rotateTo(Math.PI / 2, 0);
    w.step(STILL, STEP);
    w.step(press(RIGHT), STEP);
    for (let i = 1; i < DASH_STEPS; i++) w.step(STILL, STEP);
    const p = w.box.toWorld(w.soul.pos);
    expect(p.x - w.box.x).toBeCloseTo(DASH_DISTANCE, 4);
    expect(p.y - w.box.y).toBeCloseTo(0, 4);
  });

  it('moves less than the interpolation snap distance per step (drawn smoothly, not as a teleport)', () => {
    const w = world();
    w.soul.pos.x = -100;
    w.step(press(RIGHT), STEP);
    for (let i = 0; i < DASH_STEPS; i++) {
      const d = Math.hypot(w.soul.pos.x - w.soul.prev.x, w.soul.pos.y - w.soul.prev.y);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(SNAP_DISTANCE);
      w.step(STILL, STEP);
    }
  });

  it('a dead soul cannot dash', () => {
    const w = world();
    w.soul.hp = 0;
    w.step(press(RIGHT), STEP);
    expect(w.ability!.ready).toBe(true);
  });
});

describe('loadout', () => {
  it('defaults to dash in the active slot, empty passive', () => {
    expect(DEFAULT_LOADOUT).toEqual({ active: 'dash', passive: null });
    expect(createActive(DEFAULT_LOADOUT)).toBeInstanceOf(Dash);
    expect(createActive({ active: null, passive: null })).toBeNull();
  });
  it('round-trips on its own key, separate from settings', () => {
    expect(LOADOUT_KEY).not.toBe(SETTINGS_KEY);
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(saveLoadout(store, { active: null, passive: null })).toBe(true);
    expect([...m.keys()]).toEqual([LOADOUT_KEY]);
    expect(loadLoadout(store)).toEqual({ active: null, passive: null });
  });
  it('corrupt, wrong version or unknown ids fall back field by field; storage errors never throw', () => {
    expect(parseLoadout('{')).toEqual(DEFAULT_LOADOUT);
    expect(parseLoadout(JSON.stringify({ v: 9, active: null }))).toEqual(DEFAULT_LOADOUT);
    expect(parseLoadout(JSON.stringify({ v: 1, active: 'laser', passive: null }))).toEqual({ active: 'dash', passive: null });
    expect(parseLoadout(serializeLoadout({ active: 'dash', passive: null }))).toEqual(DEFAULT_LOADOUT);
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadLoadout(bad)).toEqual(DEFAULT_LOADOUT);
    expect(saveLoadout(bad, DEFAULT_LOADOUT)).toBe(false);
  });
});
