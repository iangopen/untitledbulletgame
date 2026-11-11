import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig, type CharacterConfig } from './config';
import { prismConfig } from './prism/prism.config';
import { Prism, REFRACTED } from './prism/Prism';
import { registry } from './registry';
import { World } from '../core/World';
import { EventBus, type GameEvents } from '../core/EventBus';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../tuning';
import type { Bullet } from '../combat/Bullet';
import { STEP } from '../core/Clock';

type T = 'shot' | 'wave';
const cfg: CharacterConfig<T> = {
  id: 'test',
  maxLevel: 10,
  bands: [
    { from: 1, to: 5, attacks: { shot: { cooldown: [2, 1], damage: [4, 8], count: [3, 6] } } },
    { from: 6, to: 6, attacks: { shot: { cooldown: [0.9, 0.9], damage: [9, 9], count: [7, 7] }, wave: { cooldown: [3, 3], speed: [50, 50] } } },
    { from: 7, to: 10, attacks: { shot: { cooldown: [0.8, 0.5], damage: [10, 16], count: [7, 10] }, wave: { cooldown: [3, 2], speed: [60, 90] } } },
  ],
  rules: {},
};

describe('resolveLevel', () => {
  it('level 0 is inactive with no attacks', () => {
    expect(resolveLevel(cfg, 0)).toEqual({ level: 0, band: -1, attacks: {} });
  });
  it('band start uses the start of each range', () => {
    expect(resolveLevel(cfg, 1).attacks.shot).toEqual({ cooldown: 2, damage: 4, count: 3 });
    expect(resolveLevel(cfg, 7).attacks.wave).toEqual({ cooldown: 3, speed: 60 });
  });
  it('band end uses the end of each range', () => {
    expect(resolveLevel(cfg, 5).attacks.shot).toEqual({ cooldown: 1, damage: 8, count: 6 });
    expect(resolveLevel(cfg, 10).attacks.shot).toEqual({ cooldown: 0.5, damage: 16, count: 10 });
  });
  it('midpoints interpolate linearly; counts round', () => {
    const mid = resolveLevel(cfg, 3).attacks.shot!;
    expect(mid.cooldown).toBeCloseTo(1.5);
    expect(mid.damage).toBeCloseTo(6);
    expect(mid.count).toBe(5); // 4.5 rounds to 5
    const m2 = resolveLevel(cfg, 8).attacks.wave!;
    expect(m2.speed).toBeCloseTo(70);
  });
  it('a single-level band uses its start value', () => {
    expect(resolveLevel(cfg, 6).attacks.shot).toEqual({ cooldown: 0.9, damage: 9, count: 7 });
  });
  it('picks the right band at each edge', () => {
    expect([5, 6, 7].map((l) => resolveLevel(cfg, l).band)).toEqual([0, 1, 2]);
    expect(Object.keys(resolveLevel(cfg, 5).attacks)).toEqual(['shot']);
    expect(Object.keys(resolveLevel(cfg, 6).attacks)).toEqual(['shot', 'wave']);
  });
  it('clamps out-of-range levels and floors fractions', () => {
    expect(resolveLevel(cfg, 99).level).toBe(10);
    expect(resolveLevel(cfg, -3).level).toBe(0);
    expect(resolveLevel(cfg, 4.9).level).toBe(4);
  });
});

describe('validateConfig', () => {
  it('accepts a good config and every registered character config', () => {
    expect(validateConfig(cfg)).toEqual([]);
    expect(validateConfig(prismConfig)).toEqual([]);
  });
  it('catches gaps, dropped attacks and bad cooldowns', () => {
    const bad: CharacterConfig<T> = {
      id: 'bad', maxLevel: 10, rules: {},
      bands: [
        { from: 1, to: 4, attacks: { shot: { cooldown: [1, 1] }, wave: { cooldown: [0, 1] } } },
        { from: 6, to: 10, attacks: { shot: { cooldown: [1, 1] } } },
      ],
    };
    const errs = validateConfig(bad).join('\n');
    expect(errs).toMatch(/starts at 6, expected 5/);
    expect(errs).toMatch(/drops attack "wave"/);
    expect(errs).toMatch(/cooldown must be > 0/);
  });
});

describe('Prism bands', () => {
  const attacksAt = (l: number) => Object.keys(resolveLevel(prismConfig, l).attacks).sort();
  it('1-5 volley; 6-14 + beam; 15-20 + prism', () => {
    for (const l of [1, 3, 5]) expect(attacksAt(l)).toEqual(['volley']);
    for (const l of [6, 10, 14]) expect(attacksAt(l)).toEqual(['beam', 'volley']);
    for (const l of [15, 20]) expect(attacksAt(l)).toEqual(['beam', 'prism', 'volley']);
  });
  it('difficulty never decreases with level (damage, speed up; cooldown down)', () => {
    for (const atk of ['volley', 'beam'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(prismConfig, l).attacks[atk];
        if (!a) continue;
        if (prev) {
          expect(a.damage!).toBeGreaterThanOrEqual(prev.damage!);
          expect(a.speed!).toBeGreaterThanOrEqual(prev.speed!);
          expect(a.cooldown!).toBeLessThanOrEqual(prev.cooldown!);
        }
        prev = a;
      }
    }
  });
});

const still = { dx: 0, dy: 0, slow: false };
function run(w: World, c: Prism, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    c.tick(STEP);
    w.step(still, STEP);
    w.soul.iframes = 1; // keep the soul alive; we test spawning, not damage
  }
}
function record(bus: EventBus) {
  const log: { [K in 'beamFired' | 'beamHitWall' | 'beamRefracted']: GameEvents[K][] } = { beamFired: [], beamHitWall: [], beamRefracted: [] };
  bus.on('beamFired', (e) => log.beamFired.push(e));
  bus.on('beamHitWall', (e) => log.beamHitWall.push(e));
  bus.on('beamRefracted', (e) => log.beamRefracted.push(e));
  return log;
}

describe('Prism behaviour', () => {
  it('is in the registry and level 0 spawns nothing', () => {
    expect(registry.map((r) => r.id)).toContain('prism');
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(0);
    run(w, p, 20);
    expect(w.pool.activeCount).toBe(0);
    expect(w.props.length).toBe(0);
  });
  it('volleys: constant spacing at levels 1, 10 and 20, one safe gap, all white, starting off screen', () => {
    for (const level of [1, 10, 20]) {
      const w = new World(640, 369);
      const p = new Prism(w);
      p.setLevel(level);
      let row: Bullet[] = [];
      const opening = new Set<Bullet>();
      for (let i = 0; i < 60 * 12 && row.length === 0; i++) {
        p.tick(STEP);
        // Skip the opening row: it is pre-fired already partway in (see Character.preFire).
        if (i === 0) w.pool.all.forEach((b) => b.active && opening.add(b));
        row = w.pool.all.filter((b) => b.active && b.shape === 'triangle' && b.age === 0 && !opening.has(b));
      }
      // Rows can spawn in the same step (battle-start shift); keep the one moving like the first.
      row = row.filter((b) => Math.sign(b.vx) === Math.sign(row[0]!.vx) && Math.sign(b.vy) === Math.sign(row[0]!.vy));
      const r = resolveLevel(prismConfig, level).attacks.volley!;
      const horizontal = row[0]!.vx === 0; // moving vertically = came from top/bottom
      const along = row.map((b) => (horizontal ? b.x : b.y)).sort((a, b) => a - b);
      const slots = Math.floor((horizontal ? w.box.width : w.box.height) / prismConfig.rules.volleySpacing);
      expect(row.length).toBe(slots - r.gapSize!);
      const gaps = along.slice(1).map((v, i) => +(v - along[i]!).toFixed(6));
      const sp = prismConfig.rules.volleySpacing;
      // Neighbours are exactly one spacing apart, except the one safe gap of gapSize missing slots.
      expect(gaps.filter((g) => g !== sp)).toEqual(gaps.some((g) => g !== sp) ? [+(sp * (r.gapSize! + 1)).toFixed(6)] : []);
      // eslint-disable-next-line no-console
      console.log(`L${level}: ${row.length} triangles from ${horizontal ? 'top/bottom' : 'a side'}, spacing ${[...new Set(gaps)].join(' / ')} px (gap ${r.gapSize} slots)`);
      for (const b of row) {
        expect(b.kind).toBe('white');
        const wp = w.box.toWorld(b);
        const off = wp.x < 0 || wp.x > SCREEN_WIDTH || wp.y < 0 || wp.y > SCREEN_HEIGHT;
        expect(off).toBe(true);
      }
    }
  });
  it('volleys reach the box on the cooldown beat (off-screen lead is planned ahead)', () => {
    const w = new World(640, 369);
    const p = new Prism(w);
    p.setLevel(5);
    const cd = resolveLevel(prismConfig, 5).attacks.volley!.cooldown!;
    // Group triangles by the step they spawned in (one row each); a row arrives when its first
    // triangle's center enters the box.
    const spawnStep = new Map<Bullet, number>();
    const rowArrival = new Map<number, number>();
    for (let i = 0; i < 60 * 30; i++) {
      p.tick(STEP);
      for (const b of w.pool.all) if (b.active && b.shape === 'triangle' && !spawnStep.has(b)) spawnStep.set(b, i);
      w.step(still, STEP);
      w.soul.iframes = 1;
      for (const [b, st] of spawnStep) {
        if (!b.active || rowArrival.has(st)) continue;
        if (Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight) rowArrival.set(st, w.time);
      }
      for (const b of [...spawnStep.keys()]) if (!b.active) spawnStep.delete(b);
    }
    const arrivals = [...rowArrival.values()].sort((a, b) => a - b);
    const spacing = arrivals.slice(1).map((t, i) => t - arrivals[i]!);
    // eslint-disable-next-line no-console
    console.log(`L5 arrivals (s): ${arrivals.map((t) => t.toFixed(2)).join(' ')}`);
    expect(arrivals.length).toBeGreaterThan(10);
    for (const d of spacing.slice(1)) expect(Math.abs(d - cd)).toBeLessThan(STEP * 2 + 1e-9);
  });
  it('the first attack reaches the box about 1 s into a battle (pre-fired) at levels 1, 10 and 20', () => {
    for (const level of [1, 10, 20]) {
      const w = new World(640, 369);
      const p = new Prism(w);
      p.setLevel(level);
      let first = -1;
      for (let i = 0; i < 60 * 5 && first < 0; i++) {
        p.tick(STEP);
        w.step(still, STEP);
        w.soul.iframes = 1;
        const inside = w.pool.all.some((b) => b.active && Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight);
        if (inside) first = w.time;
      }
      // eslint-disable-next-line no-console
      console.log(`L${level}: first projectile reaches the box at ${first.toFixed(3)} s`);
      expect(first).toBeGreaterThan(0.9);
      expect(first).toBeLessThan(1.1);
    }
  });
  it('entering the box never fires a wall hook; leaving it does', () => {
    const w = new World(640, 369);
    const walls: string[] = [];
    w.pool.spawn({ shape: 'circle', x: -w.box.halfWidth - 300, y: 0, vx: 300, a: 9, damage: 1, onWall: (_b, wall) => (walls.push(wall), 'pass') });
    for (let i = 0; i < 60 * 3; i++) w.pool.update(STEP, w.box);
    expect(walls).toEqual(['right']);
  });
  it('attackStarted fires when the first projectile of an attack spawns', () => {
    const w = new World(640, 369);
    const p = new Prism(w);
    p.setLevel(10);
    const events: { attack: string; spawnedNow: number }[] = [];
    w.bus.on('attackStarted', (e) => events.push({ attack: e.attack, spawnedNow: w.pool.all.filter((b) => b.active && b.age === 0 && b.owner === 'prism').length }));
    run(w, p, 15);
    expect(events.some((e) => e.attack === 'volley')).toBe(true);
    expect(events.some((e) => e.attack === 'beam')).toBe(true);
    expect(events.every((e) => e.spawnedNow > 0)).toBe(true);
  });
  it('beams split once at a wall; children never split again', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(10);
    const log = record(w.bus);
    run(w, p, 12);
    const original = log.beamHitWall.filter((e) => e.gen === 0);
    const children = log.beamHitWall.filter((e) => e.gen === 1);
    expect(original.length).toBeGreaterThan(0);
    expect(original.every((e) => e.split)).toBe(true);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((e) => !e.split)).toBe(true);
    // every split spawned exactly two gen-1 beams
    expect(log.beamFired.filter((e) => e.gen === 1).length).toBe(original.length * 2);
    expect(log.beamFired.some((e) => e.gen > 1)).toBe(false);
  });
  it('the refraction prism is placed at 15+, removed below, and never damages', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(15);
    expect(w.props.length).toBe(1);
    w.soul.pos.x = p.prop!.x;
    w.soul.pos.y = p.prop!.y;
    w.step(still, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp);
    p.setLevel(14);
    expect(w.props.length).toBe(0);
  });
  it('a beam through the prism becomes exactly three that ignore prisms', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(20);
    const prop = p.prop!;
    prop.x = 0; prop.y = 0; prop.rotation = 0;
    const log = record(w.bus);
    // fire one beam by hand straight through the prism
    w.pool.clear();
    (p as unknown as { spawnBeam: (...a: unknown[]) => void }).spawnBeam(-140, 0, 0, 200, resolveLevel(prismConfig, 20).attacks.beam, 0, 0, false);
    for (let i = 0; i < 60; i++) {
      (p as unknown as { update: () => void }).update();
      w.pool.update(STEP, w.box);
    }
    expect(log.beamRefracted).toHaveLength(1);
    expect(log.beamRefracted[0]!.count).toBe(3);
    const refracted = log.beamFired.filter((e) => e !== log.beamFired[0]);
    expect(refracted).toHaveLength(3);
    // they all carry REFRACTED and never refract again
    const live = w.pool.all.filter((b) => b.active);
    expect(live.every((b) => (b.flags & REFRACTED) !== 0)).toBe(true);
    // refracted beams exit without splitting (refractedCanSplit = false)
    expect(log.beamHitWall.every((e) => !e.split)).toBe(true);
  });
  it('level 20 stays bounded over a long run', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(20);
    let peak = 0;
    for (let i = 0; i < 60 * 60; i++) {
      p.tick(STEP);
      w.step(still, STEP);
      w.soul.iframes = 1;
      peak = Math.max(peak, w.pool.activeCount);
    }
    expect(w.pool.dropped).toBe(0);
    expect(peak).toBeLessThan(200);
  });
});

describe('EventBus', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('beamFired', (e) => got.push(e.gen));
    bus.emit('beamFired', { owner: 'x', x: 0, y: 0, angle: 0, gen: 1 });
    off();
    bus.emit('beamFired', { owner: 'x', x: 0, y: 0, angle: 0, gen: 2 });
    expect(got).toEqual([1]);
  });
});
