import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { MIRROR_BEAM, Prism } from './Prism';
import { emitterForm, mirrorForm, prismConfig } from './prism.config';
import { mirrorAngle, pathLength, pointAt, reflect } from './mirrorPath';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import type { Bullet } from '../../combat/Bullet';
import { bulletPrimitives } from '../../combat/composite';
import { bulletHitsCircle } from '../../combat/hitTest';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { interpBullet } from '../../render/interp';
import { Bullet as BulletClass } from '../../combat/Bullet';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';
import { hud } from '../../render/theme';

const R = prismConfig.rules;
const still = { dx: 0, dy: 0, slow: false };
const P20 = () => resolveLevel(prismConfig, 20).attacks;
const isMirror = (b: Bullet) => b.decor && b.form === mirrorForm(R.mirrorSize, R.mirrorThickness);
const isEmitter = (b: Bullet) => b.decor && b.form === emitterForm(R.emitterSize);
const isLaser = (b: Bullet) => b.owner === 'prism' && b.shape === 'rect';
const onScreenClear = (a: { x0: number; y0: number; x1: number; y1: number }) =>
  a.x0 >= 0 && a.x1 <= SCREEN_WIDTH && a.y0 >= hud.top.y + hud.top.height && a.y1 <= hud.bottom.y;

describe('Prism config', () => {
  it('validates; Mirrors join at 6, Blaster at 15', () => {
    expect(validateConfig(prismConfig)).toEqual([]);
    expect(resolveLevel(prismConfig, 5).attacks.mirrors).toBeUndefined();
    expect(resolveLevel(prismConfig, 6).attacks.mirrors).toBeDefined();
    expect(resolveLevel(prismConfig, 14).attacks.blaster).toBeUndefined();
    expect(resolveLevel(prismConfig, 15).attacks.blaster).toBeDefined();
  });
  it('the blaster warning never drops below the fair minimum (0.25 s), at any level or tuning', () => {
    const p = new Prism(new World(0, 0));
    expect(R.minWarn).toBe(0.25);
    for (let l = 15; l <= 20; l++) expect(p.warnOf(resolveLevel(prismConfig, l).attacks.blaster!)).toBeGreaterThanOrEqual(R.minWarn);
    // Even if someone tunes the warning far too low, the floor holds.
    expect(p.warnOf({ ...P20().blaster!, warn: 0.05 })).toBe(R.minWarn);
  });
  it('phase cycles contain only unlocked attacks', () => {
    const w = new World(0, 0);
    const p = new Prism(w);
    p.setLevel(1);
    expect(p.order).toEqual(['ray']);
    p.setLevel(6);
    expect(p.order).toEqual(['ray', 'mirrors']);
    p.setLevel(15);
    expect(p.order).toEqual(['ray', 'mirrors', 'blaster']);
    p.setLevel(0);
    expect(p.order).toEqual([]);
  });
});

describe('Mirror path', () => {
  it('reflection math: a mirror at the turn reflects the incoming leg exactly into the outgoing one', () => {
    for (const [a, m, b] of [[{ x: 0, y: 0 }, { x: 100, y: 20 }, { x: -50, y: 200 }], [{ x: 5, y: 9 }, { x: 300, y: 300 }, { x: 600, y: 10 }]] as const) {
      const ang = mirrorAngle(a, m, b);
      const il = Math.hypot(m.x - a.x, m.y - a.y), ol = Math.hypot(b.x - m.x, b.y - m.y);
      const r = reflect((m.x - a.x) / il, (m.y - a.y) / il, ang);
      expect(r.x).toBeCloseTo((b.x - m.x) / ol, 9);
      expect(r.y).toBeCloseTo((b.y - m.y) / ol, 9);
    }
  });
  it('the beam follows the path through every mirror center; mirrors are drawn at the path vertices, turned to reflect; starts and ends off screen', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World(640, 369);
      const p = new Prism(w, seed);
      const at = P20().mirrors!;
      const g = p.formMirrors(at)!;
      expect(g).not.toBeNull();
      expect(g.mirrors).toHaveLength(at.count!);
      // Drawn mirrors: one decor per path vertex, at its center, at the reflecting angle.
      const drawn = w.pool.all.filter((b) => b.active && isMirror(b));
      expect(drawn).toHaveLength(at.count!);
      g.mirrors.forEach((m, i) => {
        const d = drawn[i]!;
        const wp = w.box.toWorld(d);
        expect(wp.x).toBeCloseTo(m.x, 6);
        expect(wp.y).toBeCloseTo(m.y, 6);
        expect(d.rotation + w.box.rotation).toBeCloseTo(m.angle, 9);
        expect(g.path[i + 1]).toEqual({ x: m.x, y: m.y });
        // Each mirror sits outside the box, on screen, clear of the HUD bands.
        const l = w.box.toLocal(m);
        expect(Math.abs(l.x) > w.box.halfWidth || Math.abs(l.y) > w.box.halfHeight).toBe(true);
        const s = R.mirrorSize;
        expect(onScreenClear({ x0: m.x - s, y0: m.y - s, x1: m.x + s, y1: m.y + s })).toBe(true);
      });
      const start = g.path[0]!, end = g.path[g.path.length - 1]!;
      for (const q of [start, end]) expect(q.x < 0 || q.x > SCREEN_WIDTH || q.y < 0 || q.y > SCREEN_HEIGHT).toBe(true);
      // Run it: the beam's center is on the path every step (within float error) and crosses the box `count` times.
      const L = pathLength(g.path);
      let beam: Bullet | undefined;
      let maxOff = 0, crossings = 0, wasInside = false;
      for (let i = 0; i < 60 * 12; i++) {
        w.step(still, STEP);
        w.soul.iframes = 1;
        beam ??= w.pool.all.find((b) => b.active && b.flags & MIRROR_BEAM);
        if (!beam || !beam.active) continue;
        const wp = w.box.toWorld(beam);
        let best = Infinity;
        for (let s = 0; s <= L; s += 1) {
          const q = pointAt(g.path, s);
          best = Math.min(best, Math.hypot(q.x - wp.x, q.y - wp.y));
        }
        maxOff = Math.max(maxOff, best);
        const inside = Math.abs(beam.x) <= w.box.halfWidth && Math.abs(beam.y) <= w.box.halfHeight;
        if (inside && !wasInside) crossings++;
        wasInside = inside;
      }
      expect(beam).toBeDefined();
      expect(maxOff).toBeLessThan(0.75);
      expect(crossings).toBe(at.count!);
    }
  });
  it('mirrors follow the soul box when The Warden has moved and turned it', () => {
    const w = new World(640, 369);
    w.box.moveTo(560, 380, 0);
    w.box.rotateTo(0.4, 0);
    w.box.step(STEP);
    const p = new Prism(w, 3);
    const g = p.formMirrors(P20().mirrors!);
    expect(g).not.toBeNull();
    for (const m of g!.mirrors) {
      const l = w.box.toLocal(m);
      // gap outside a wall of the box as it is now
      const out = Math.max(Math.abs(l.x) - w.box.halfWidth, Math.abs(l.y) - w.box.halfHeight);
      expect(out).toBeCloseTo(R.mirrorGap, 6);
    }
  });
});

describe('Blaster', () => {
  it('the laser collides only while firing: the warning (pre-active, thin) never hurts; the laser (thick) does; then it is gone', () => {
    const w = new World(640, 369);
    const p = new Prism(w, 2);
    const at = P20().blaster!;
    const shot = p.blast(at, 'left', 0, [0, 0])!;
    expect(shot).not.toBeNull();
    const { laser } = shot;
    expect(laser.armed).toBe(false);
    expect(laser.b).toBeCloseTo(R.warnThickness / 2, 9);
    // The soul sits on the laser's path (the box center: the laser aims there).
    w.soul.pos.x = 0;
    w.soul.pos.y = 0;
    const warn = p.warnOf(at);
    let hurtBefore = 0, hurtAfter = 0, armedStep = -1;
    let laserGoneAt = -1;
    for (let i = 0; i < Math.round((warn + R.laserTime + 0.3) / STEP); i++) {
      const hp = w.soul.hp;
      w.soul.iframes = 0;
      w.step(still, STEP);
      if (laser.active && laser.armed && armedStep < 0) armedStep = i;
      if (w.soul.hp < hp) (armedStep < 0 ? hurtBefore++ : hurtAfter++);
      w.soul.hp = w.soul.maxHp;
      if (!laser.active && laserGoneAt < 0) laserGoneAt = i;
    }
    expect(hurtBefore).toBe(0);
    expect(hurtAfter).toBeGreaterThan(0);
    expect(armedStep * STEP).toBeGreaterThan(warn - 2 * STEP);
    expect(armedStep * STEP).toBeLessThan(warn + 2 * STEP);
    expect(laserGoneAt * STEP).toBeLessThan(warn + R.laserTime + 2 * STEP);
  });
  it('the warning line is exactly on the laser path (same bullet, same center and angle), full thickness only once firing', () => {
    const w = new World(640, 369);
    const p = new Prism(w, 4);
    const { laser } = p.blast(P20().blaster!, 'right', 0.3, [0.2, -0.3])!;
    const before = { x: laser.x, y: laser.y, r: laser.rotation, a: laser.a };
    for (let i = 0; i < 60; i++) w.step(still, STEP);
    expect(laser.armed).toBe(true);
    expect({ x: laser.x, y: laser.y, r: laser.rotation, a: laser.a }).toEqual(before);
    expect(laser.b).toBeCloseTo(R.laserThickness / 2, 9);
    // Exact hitbox: probes just inside and outside the solid core, perpendicular to it.
    const c = Math.cos(laser.rotation), s = Math.sin(laser.rotation);
    const off = (d: number) => ({ x: laser.x - s * d, y: laser.y + c * d, r: 0.01 });
    expect(bulletHitsCircle(laser, off(R.laserThickness / 2 - 0.3))).toBe(true);
    expect(bulletHitsCircle(laser, off(R.laserThickness / 2 + 0.3))).toBe(false);
    // Drawn primitives == collision primitives.
    const hit: string[] = [], drawn: string[] = [];
    bulletPrimitives(laser, (q) => void hit.push(JSON.stringify(q)));
    bulletPrimitives(interpBullet(laser, 1, new BulletClass()), (q) => void drawn.push(JSON.stringify(q)));
    expect(drawn).toEqual(hit);
  });
});

/** Prism alone for `seconds` at `level` (still soul kept alive); counts per attack and checks. */
function measure(level: number, seconds = 40) {
  const w = new World(640, 369);
  const p = new Prism(w);
  p.setLevel(level);
  const phases: string[] = [];
  w.bus.on('prismPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const seen = new Set<Bullet>();
  const counts = { rays: 0, refracted: 0, mirrorVolleys: 0, mirrors: 0, mirrorBeams: 0, emitters: 0, lasers: 0 };
  let first = -1, shortestWarn = Infinity, inBand = 0, insideBox = 0, offScreen = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    p.tick(STEP);
    w.step(still, STEP);
    w.soul.iframes = 1;
    let newMirrors = 0;
    for (const b of w.pool.all) {
      if (!b.active) continue;
      if (first < 0 && b.armed && !b.decor && (b.shape === 'rect' || (Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight))) first = w.time;
      if (seen.has(b)) continue;
      seen.add(b);
      if (isMirror(b)) { counts.mirrors++; newMirrors++; }
      else if (isEmitter(b)) counts.emitters++;
      else if (isLaser(b)) { counts.lasers++; shortestWarn = Math.min(shortestWarn, b.armAt); }
      else if (b.flags & MIRROR_BEAM) counts.mirrorBeams++;
      else if (b.shape === 'beam') b.gen > 0 ? counts.refracted++ : counts.rays++;
      if (isMirror(b) || isEmitter(b)) {
        const a = bulletWorldAabb(w.box, b);
        if (aabbInBand(a)) inBand++;
        if (a.x0 < 0 || a.x1 > SCREEN_WIDTH || a.y0 < 0 || a.y1 > SCREEN_HEIGHT) offScreen++;
        if (Math.abs(b.x) < w.box.halfWidth && Math.abs(b.y) < w.box.halfHeight) insideBox++;
      }
      if (isLaser(b) && aabbInBand({ ...bulletWorldAabb(w.box, b), x0: Math.max(0, bulletWorldAabb(w.box, b).x0), x1: Math.min(SCREEN_WIDTH, bulletWorldAabb(w.box, b).x1) })) inBand++;
    }
    if (newMirrors) counts.mirrorVolleys++;
    for (const b of [...seen]) if (!b.active) seen.delete(b);
  }
  return { phases, counts, first, shortestWarn, inBand, insideBox, offScreen, dropped: w.pool.dropped, skipped: p.skippedMirrors + p.skippedBlasters };
}

describe('Prism 40 s at levels 1, 10, 20', () => {
  it('timelines, counts per attack, shortest warning, first arrival ~1 s; mirrors and emitters outside the box, on screen, clear of the bands', () => {
    for (const level of [1, 10, 20]) {
      const m = measure(level);
      // eslint-disable-next-line no-console
      console.log(`Prism L${level}: ${m.phases.join(' ')} | first attack reaches the box at ${m.first.toFixed(2)} s | ${JSON.stringify(m.counts)} | shortest blaster warning ${Number.isFinite(m.shortestWarn) ? m.shortestWarn.toFixed(3) + ' s' : '-'} | in a band ${m.inBand}, inside the box ${m.insideBox}, off screen ${m.offScreen}, skipped ${m.skipped}`);
      expect(m.first).toBeGreaterThan(0.8);
      expect(m.first).toBeLessThan(1.2);
      expect(m.phases.some((ph) => ph.startsWith('rest'))).toBe(false);
      expect(m.inBand + m.insideBox + m.offScreen + m.dropped + m.skipped).toBe(0);
      expect(m.counts.rays).toBeGreaterThan(0);
      expect(m.counts.mirrorVolleys > 0).toBe(level >= 6);
      expect(m.counts.mirrorBeams).toBe(m.counts.mirrorVolleys);
      expect(m.counts.lasers > 0).toBe(level >= 15);
      expect(m.counts.emitters).toBe(m.counts.lasers);
      if (level >= 15) expect(m.shortestWarn).toBeGreaterThanOrEqual(R.minWarn - 1e-9);
    }
  });
});
