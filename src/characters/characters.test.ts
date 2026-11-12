import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig, type CharacterConfig } from './config';
import { prismConfig } from './prism/prism.config';
import { Prism, REFRACTED } from './prism/Prism';
import { registry } from './registry';
import { World } from '../core/World';
import { EventBus, type GameEvents } from '../core/EventBus';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../tuning';
import { hud } from '../render/theme';
import type { Bullet } from '../combat/Bullet';
import { STEP } from '../core/Clock';

type T = 'shot' | 'wave';
const cfg: CharacterConfig<T> = {
  id: 'test',
  title: 'Test',
  description: 'test',
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
    for (const e of registry) expect(e.id).toBeTruthy();
  });
  it('catches gaps, dropped attacks and bad cooldowns', () => {
    const bad: CharacterConfig<T> = {
      id: 'bad', title: 'Bad', description: 'bad', maxLevel: 10, rules: {},
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
  it('every level 1-20 has both phases: volley (wall), beam and prism (ray)', () => {
    for (const l of [1, 5, 6, 10, 14, 15, 20]) expect(attacksAt(l)).toEqual(['beam', 'prism', 'volley']);
    const r = prismConfig.rules;
    expect(r.attackPhase).toEqual({ volley: 'wall', beam: 'ray', prism: 'ray' });
    expect(r.phaseOrder).toEqual(['wall', 'ray']);
    expect(r.phaseLength).toBeGreaterThan(0);
    expect(r.breather).toBeGreaterThanOrEqual(0);
    expect(r.phaseIntensity).toBeGreaterThanOrEqual(1);
  });
  it('difficulty never decreases with level (more of: damage, speed, count, aim, spread; less of: cooldown, gap)', () => {
    const up = ['damage', 'speed', 'count', 'length', 'aimChance', 'refractSpread'];
    const down = ['cooldown', 'gapSize'];
    for (const atk of ['volley', 'beam', 'prism'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(prismConfig, l).attacks[atk]!;
        expect(a).toBeDefined();
        if (prev) {
          for (const k of Object.keys(a)) {
            if (up.includes(k)) expect(a[k]!, `${atk}.${k} at L${l}`).toBeGreaterThanOrEqual(prev[k]!);
            else if (down.includes(k)) expect(a[k]!, `${atk}.${k} at L${l}`).toBeLessThanOrEqual(prev[k]!);
            else throw new Error(`unclassified param ${atk}.${k}`);
          }
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
  const log: { [K in 'beamFired' | 'beamRefracted']: GameEvents[K][] } = { beamFired: [], beamRefracted: [] };
  bus.on('beamFired', (e) => log.beamFired.push(e));
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
    // Inside a wall phase rows arrive every cooldown / phaseIntensity; longer gaps are the ray
    // phase and breathers (and the battle-start shift of the second row).
    const beat = cd / prismConfig.rules.phaseIntensity;
    const inPhase = spacing.filter((d) => d < beat * 1.5);
    expect(inPhase.length).toBeGreaterThan(10);
    for (const d of inPhase) expect(Math.abs(d - beat)).toBeLessThan(STEP * 2 + 1e-9);
    for (const d of spacing.filter((d) => d >= beat * 1.5)) expect(d).toBeGreaterThan(prismConfig.rules.breather);
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
    // Projectile attacks light up when their first projectile spawns; the prism relocation has none.
    expect(events.filter((e) => e.attack !== 'prism').every((e) => e.spawnedNow > 0)).toBe(true);
  });
  it('phases: only volleys reach the box in wall phases, only rays in ray phases; all white; nothing spawns inside except refractions; no splits', () => {
    for (const level of [1, 10, 20]) {
      const w = new World(640, 369);
      const p = new Prism(w);
      p.setLevel(level);
      const phases: string[] = [];
      w.bus.on('prismPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
      const log = record(w.bus);
      const seen = new Set<Bullet>();
      const entered = new Set<Bullet>();
      let insideSpawns = 0;
      let refractedInside = 0;
      let wrongPhase = 0;
      let prismInWall = 0;
      const counts = { volley: 0, ray: 0 };
      for (let i = 0; i < 60 * 40; i++) {
        p.tick(STEP);
        // New bullets this tick (spawned by the character, before the world moves them).
        for (const b of w.pool.all) {
          if (!b.active || seen.has(b)) continue;
          seen.add(b);
          expect(b.kind).toBe('white');
          if (Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight) {
            if (b.flags & REFRACTED) refractedInside++;
            else insideSpawns++;
          }
        }
        w.step(still, STEP);
        w.soul.iframes = 1;
        if (p.phase === 'wall' && w.props.length > 0) prismInWall++;
        for (const b of w.pool.all) {
          if (!b.active || entered.has(b) || b.flags & REFRACTED) continue;
          if (Math.abs(b.x) > w.box.halfWidth || Math.abs(b.y) > w.box.halfHeight) continue;
          entered.add(b);
          const want = b.shape === 'triangle' ? 'wall' : 'ray';
          counts[b.shape === 'triangle' ? 'volley' : 'ray']++;
          // Within a step either side of the detection (sim clock vs. detection rounding at window edges).
          if (![-2 * STEP, 0, STEP].some((d) => p.phaseAt(w.time + d).phase === want)) wrongPhase++;
        }
        for (const b of [...seen]) if (!b.active) { seen.delete(b); entered.delete(b); }
      }
      // eslint-disable-next-line no-console
      console.log(`L${level}: ${phases.join(' ')} | entered: ${counts.volley} triangles, ${counts.ray} rays | spawned inside: ${insideSpawns} (refracted at prism: ${refractedInside}) | wrong phase: ${wrongPhase} | refractions ${log.beamRefracted.length}`);
      expect(phases.slice(0, 5)).toEqual(['wall@0.0', 'breather@8.0', 'ray@9.0', 'breather@17.0', 'wall@18.0']);
      expect(wrongPhase).toBe(0);
      expect(insideSpawns).toBe(0);
      expect(prismInWall).toBe(0);
      expect(counts.volley).toBeGreaterThan(0);
      expect(counts.ray).toBeGreaterThan(0);
    }
  });
  it('rays never split: no wall hook, and the only extra beams come from refractions (3 each)', () => {
    const w = new World(640, 369);
    const p = new Prism(w);
    p.setLevel(20);
    const log = record(w.bus);
    let hooks = 0;
    for (let i = 0; i < 60 * 40; i++) {
      p.tick(STEP);
      for (const b of w.pool.all) if (b.active && b.onWall) hooks++;
      w.step(still, STEP);
      w.soul.iframes = 1;
    }
    expect(hooks).toBe(0);
    expect(log.beamRefracted.length).toBeGreaterThan(0);
    // Every extra beam is a refraction (gen 1): exactly 3 per refraction event, none from walls.
    expect(log.beamFired.filter((e) => e.gen === 1).length).toBe(log.beamRefracted.length * 3);
    expect(log.beamFired.every((e) => e.gen <= 1)).toBe(true);
  });
  it('the refraction prism shows from the breather before a ray phase to its end, and never damages', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(1);
    run(w, p, 4);
    expect(w.props.length).toBe(0); // wall phase
    run(w, p, 4.5); // 8.5 s: breather before the ray phase
    expect(w.props.length).toBe(1);
    w.soul.pos.x = p.prop!.x;
    w.soul.pos.y = p.prop!.y;
    w.step(still, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp);
    run(w, p, 9); // 17.5 s: breather before the wall phase
    expect(w.props.length).toBe(0);
    p.setLevel(0);
    expect(w.props.length).toBe(0);
  });
  it('refraction prisms stand only outside the box, on screen, clear of the HUD bands; refracted rays still reach the box', () => {
    const w = new World(640, 369);
    const p = new Prism(w, 1);
    p.setLevel(20);
    const placed: string[] = [];
    let last = '';
    let inside = 0;
    let refractedEntered = 0;
    const seen = new Set<Bullet>();
    const r = prismConfig.rules.prismRadius;
    for (let i = 0; i < 60 * 40; i++) {
      p.tick(STEP);
      w.step(still, STEP);
      w.soul.iframes = 1;
      const prop = p.prop;
      if (prop) {
        const key = `${prop.x.toFixed(1)},${prop.y.toFixed(1)}`;
        if (key !== last) {
          last = key;
          const wp = w.box.toWorld(prop);
          placed.push(`(${wp.x.toFixed(0)}, ${wp.y.toFixed(0)})@${w.time.toFixed(1)}`);
          // The whole prism (its circumcircle) is outside the box, on screen, outside the bands.
          if (Math.abs(prop.x) < w.box.halfWidth + r && Math.abs(prop.y) < w.box.halfHeight + r) inside++;
          expect(wp.x - r).toBeGreaterThan(0);
          expect(wp.x + r).toBeLessThan(SCREEN_WIDTH);
          expect(wp.y - r).toBeGreaterThan(hud.top.y + hud.top.height);
          expect(wp.y + r).toBeLessThan(hud.bottom.y);
        }
      }
      for (const b of w.pool.all) {
        if (!b.active || seen.has(b) || !(b.flags & REFRACTED)) continue;
        if (Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight) { seen.add(b); refractedEntered++; }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`L20 prism placements (world): ${placed.join(' ')}; inside the box: ${inside}; refracted rays that entered the box: ${refractedEntered}`);
    expect(placed.length).toBeGreaterThan(2);
    expect(inside).toBe(0);
    expect(refractedEntered).toBeGreaterThan(0);
  });
  it('a beam through the prism becomes exactly three that ignore prisms', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(20);
    run(w, p, 10); // into the ray phase
    // The prism is world-fixed beside the box (it steps aside if the box covers it): put it left of the box.
    const px0 = -w.box.halfWidth - 60;
    (p as unknown as { propWorld: { x: number; y: number; rotation: number } }).propWorld = { x: w.box.x + px0, y: w.box.y, rotation: 0 };
    const log = record(w.bus);
    // fire one beam by hand straight through the prism
    w.pool.clear();
    (p as unknown as { spawnBeam: (...a: unknown[]) => void }).spawnBeam(px0 - 140, 0, 0, 200, resolveLevel(prismConfig, 20).attacks.beam, 0, 0, false);
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
    expect(live.every((b) => !b.onWall)).toBe(true);
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
