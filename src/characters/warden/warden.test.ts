import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { FIST_FORM, wardenConfig } from './warden.config';
import { Warden } from './Warden';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Director } from '../../director/Director';
import { TimerMode } from '../../director/modes/TimerMode';
import { registry } from '../registry';
import { aabbInBand, bulletWorldAabb, PLAY_BOTTOM, PLAY_TOP, rotatedHalfExtents } from '../../combat/bands';
import { VIEW } from '../../render/theme';
import type { Bullet } from '../../combat/Bullet';
import type { MoveInput } from '../../core/Soul';

const STILL: MoveInput = { dx: 0, dy: 0, slow: false };
const attacksAt = (l: number) => Object.keys(resolveLevel(wardenConfig, l).attacks).sort();

describe('The Warden config', () => {
  it('validates, and is registered as slot 4 with the golem shape', () => {
    expect(validateConfig(wardenConfig)).toEqual([]);
    expect(registry[3]).toMatchObject({ id: 'warden', shape: 'golem', maxLevel: 20 });
  });
  it('punch 1-20; spin joins at 6', () => {
    for (const l of [1, 5]) expect(attacksAt(l)).toEqual(['punch']);
    for (const l of [6, 14, 15, 20]) expect(attacksAt(l)).toEqual(['punch', 'spin']);
  });
  it('difficulty never decreases with level, per parameter', () => {
    const up = ['distance', 'vertical', 'speed', 'duration', 'reverse'];
    const down = ['cooldown', 'windup', 'back'];
    for (const atk of ['punch', 'spin'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(wardenConfig, l).attacks[atk];
        if (!a) continue;
        if (prev) {
          for (const k of Object.keys(a)) {
            if (down.includes(k)) expect(a[k]!, `${atk}.${k} L${l}`).toBeLessThanOrEqual(prev[k]!);
            else if (up.includes(k)) expect(a[k]!, `${atk}.${k} L${l}`).toBeGreaterThanOrEqual(prev[k]!);
            else throw new Error(`unclassified ${atk}.${k}`);
          }
        }
        prev = a;
      }
    }
  });
  it('a punch and its return fit inside the cooldown; a spin and its return fit too', () => {
    const r = wardenConfig.rules;
    for (let l = 1; l <= 20; l++) {
      const { punch, spin } = resolveLevel(wardenConfig, l).attacks;
      expect(punch!.back! + r.shoveTime + punch!.windup! + r.lungeTime, `L${l}`).toBeLessThanOrEqual(punch!.cooldown!);
      if (spin) expect(spin.duration! + r.spinReturn, `L${l}`).toBeLessThanOrEqual(spin.cooldown!);
    }
  });
});

/** World AABB of the box's rotated outline. */
function boxAabb(w: World) {
  const b = w.box;
  const e = rotatedHalfExtents(b.width, b.height, b.rotation);
  return { x0: b.x - e.hx, x1: b.x + e.hx, y0: b.y - e.hy, y1: b.y + e.hy };
}

function runWarden(level: number, seconds: number, input: MoveInput) {
  const w = new World(640, 369);
  const c = new Warden(w, 4);
  c.setLevel(level);
  const phases: string[] = [];
  w.bus.on('wardenPhaseChanged', (e) => phases.push(`${e.phase}@${(c as unknown as { clock: number }).clock.toFixed(1)}`));
  let hp = 0;
  const ext = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, rot: 0 };
  let boxOut = 0, fistInBand = 0, fistOff = 0, fistInBox = 0, fistSteps = 0;
  for (let i = 0; i < seconds * 60; i++) {
    c.tick(STEP);
    const before = w.soul.hp;
    w.step(input, STEP);
    hp += before - w.soul.hp;
    const a = boxAabb(w);
    ext.x0 = Math.min(ext.x0, a.x0); ext.x1 = Math.max(ext.x1, a.x1);
    ext.y0 = Math.min(ext.y0, a.y0); ext.y1 = Math.max(ext.y1, a.y1);
    ext.rot = Math.max(ext.rot, Math.abs(w.box.rotation));
    if (a.x0 < 0 || a.x1 > VIEW.width || a.y0 < PLAY_TOP || a.y1 > PLAY_BOTTOM) boxOut++;
    for (const b of w.pool.all) {
      if (!b.active) continue;
      expect(b.decor).toBe(true);
      fistSteps++;
      const f = bulletWorldAabb(w.box, b);
      if (aabbInBand(f)) fistInBand++;
      if (f.x0 < 0 || f.x1 > VIEW.width || f.y0 < 0 || f.y1 > VIEW.height) fistOff++;
      // Never inside the box: every part is beyond its wall (box-local, 0.01 px tolerance).
      if (insideBox(w, b)) fistInBox++;
    }
  }
  return { w, c, phases, hp, ext, boxOut, fistInBand, fistOff, fistInBox, fistSteps };
}

function insideBox(w: World, b: Bullet): boolean {
  const hw = w.box.halfWidth - 0.01, hh = w.box.halfHeight - 0.01;
  // The fist's front (origin) touches the wall at most; any part reaching inside counts.
  let inside = false;
  const cos = Math.cos(b.rotation), sin = Math.sin(b.rotation);
  for (const p of FIST_FORM.parts) {
    if (p.kind !== 'rect') continue;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const lx = p.x + sx * p.hw, ly = p.y + sy * p.hh;
      const r = p.rot ?? 0;
      const qx = lx * Math.cos(r) - ly * Math.sin(r), qy = lx * Math.sin(r) + ly * Math.cos(r);
      const x = b.x + qx * cos - qy * sin, y = b.y + qx * sin + qy * cos;
      if (Math.abs(x) < hw && Math.abs(y) < hh) inside = true;
    }
  }
  return inside;
}

describe('The Warden behaviour', () => {
  it('L1/L10/L20 over 40 s: phases, punches and spins; box always on screen and clear of the bands; zero damage alone', () => {
    const expected: Record<number, string[]> = {
      1: ['punch@0.0', 'breather@8.0', 'punch@9.0', 'breather@17.0', 'punch@18.0'],
      10: ['punch@0.0', 'breather@8.0', 'spin@9.0', 'breather@17.0', 'punch@18.0'],
      20: ['punch@0.0', 'breather@8.0', 'spin@9.0', 'breather@17.0', 'punch@18.0'],
    };
    for (const level of [1, 10, 20]) {
      for (const input of [STILL, { dx: 1, dy: 0, slow: false }, { dx: -1, dy: 1, slow: false }]) {
        const r = runWarden(level, 40, input);
        const moving = input !== STILL;
        if (!moving) {
          // eslint-disable-next-line no-console
          console.log(
            `Warden L${level} 40 s: ${r.phases.join(' ')} | punches ${r.c.stats.punches}, returns ${r.c.stats.returns}, spins ${r.c.stats.spins} (${r.c.stats.swings} swings) | ` +
              `box outline x ${r.ext.x0.toFixed(0)}-${r.ext.x1.toFixed(0)}, y ${r.ext.y0.toFixed(0)}-${r.ext.y1.toFixed(0)}, max |rot| ${((r.ext.rot * 180) / Math.PI).toFixed(1)} deg | ` +
              `steps off screen/in a band: box ${r.boxOut}, fist ${r.fistInBand + r.fistOff} of ${r.fistSteps}; fist parts inside the box: ${r.fistInBox}`,
          );
        }
        expect(r.phases.slice(0, 5)).toEqual(expected[level]);
        expect(r.c.stats.punches).toBeGreaterThan(3);
        // The last return may still be due when the run ends.
        expect(r.c.stats.returns).toBeGreaterThanOrEqual(r.c.stats.punches - 1);
        if (level >= 6) expect(r.c.stats.spins).toBeGreaterThan(0);
        else expect(r.c.stats.spins).toBe(0);
        expect(r.boxOut).toBe(0);
        expect(r.fistInBand).toBe(0);
        expect(r.fistOff).toBe(0);
        expect(r.fistInBox).toBe(0);
        expect(r.hp).toBe(0);
      }
    }
  });

  it('a fist overlapping the soul never hurts', () => {
    const w = new World(640, 369);
    const b = w.pool.spawn({ shape: 'composite', form: FIST_FORM, a: 0, x: 0, y: 0, damage: 50, decor: true })!;
    expect(b).toBeTruthy();
    for (let i = 0; i < 30; i++) w.step({ dx: 1, dy: 0, slow: false }, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp);
  });

  it('spins stay inside the safe angle, and the box is upright again after each spin', () => {
    const w = new World(640, 369);
    const c = new Warden(w, 4);
    c.setLevel(20);
    const A = c.safeAngle();
    let max = 0;
    for (let i = 0; i < 60 * 18; i++) {
      c.tick(STEP);
      w.step(STILL, STEP);
      max = Math.max(max, Math.abs(w.box.rotation));
    }
    expect(max).toBeGreaterThan(A * 0.7);
    expect(max).toBeLessThanOrEqual(A + 1e-9);
    // 18 s = after the first spin phase (9-17) and its breather.
    expect(Math.abs(w.box.rotation)).toBeLessThan(1e-9);
  });
});

describe('bullets stay world-fixed while the box moves; the soul rides it', () => {
  it('moveTo and rotateTo leave a bullet where it was in the world, heading the same way', () => {
    const w = new World(640, 369);
    const b = w.pool.spawn({ shape: 'circle', a: 5, x: -300, y: 0, vx: 0, vy: 0, damage: 1, noPop: true })!;
    const start = w.box.toWorld(b);
    const soul0 = w.box.toWorld(w.soul.pos);
    w.box.moveTo(840, 400, 0.3);
    w.box.rotateTo(0.4, 0.3);
    for (let i = 0; i < 30; i++) w.step(STILL, STEP);
    const now = w.box.toWorld(b);
    expect(now.x).toBeCloseTo(start.x, 6);
    expect(now.y).toBeCloseTo(start.y, 6);
    const soul1 = w.box.toWorld(w.soul.pos);
    expect(soul1.x - soul0.x).toBeCloseTo(200, 6);
    // A moving bullet keeps its world velocity through a turn.
    const m = w.pool.spawn({ shape: 'circle', a: 5, x: 0, y: -300, vx: 100, vy: 0, damage: 1, noPop: true })!;
    const p0 = w.box.toWorld(m);
    w.box.rotateTo(-0.4, 0.5);
    for (let i = 0; i < 30; i++) w.step(STILL, STEP);
    const p1 = w.box.toWorld(m);
    const dir = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    // World heading at spawn: +x in a box turned by 0.4 rad.
    expect(dir).toBeCloseTo(0.4, 6);
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(50, 6);
  });
});

describe('all four characters with a displaced box', () => {
  it('level 15, 40 s: no spawn or gold form in a HUD band; spawns while displaced are aimed at the box where it is', () => {
    const w = new World(640, 369);
    const d = new Director(w, { prism: 15, mortimer: 15, ulysses: 15, warden: 15 }, new TimerMode(60));
    const seen = new Set<Bullet>();
    let spawns = 0, spawnInBand = 0, goldSteps = 0, goldInBand = 0;
    let displacedSpawns = 0, tracked = 0, displacedSteps = 0;
    const home = w.box.defaults;
    for (let i = 0; i < 60 * 40; i++) {
      d.characters.forEach((c) => c.tick(STEP));
      const displaced = Math.hypot(w.box.x - home.x, w.box.y - home.y) > 5 || Math.abs(w.box.rotation) > 0.02;
      if (displaced) displacedSteps++;
      for (const b of w.pool.all) {
        if (!b.active || b.decor) continue;
        const a = bulletWorldAabb(w.box, b);
        if (!seen.has(b)) {
          seen.add(b);
          spawns++;
          if (aabbInBand(a)) {
            spawnInBand++;
            if (spawnInBand < 12) console.log('IN BAND', i, b.owner, b.shape, b.armed, b.age.toFixed(3), JSON.stringify(a), w.box.x.toFixed(0), w.box.y.toFixed(0), b.x.toFixed(0), b.y.toFixed(0), b.vx.toFixed(0), b.vy.toFixed(0));
          }
          // Children of a refraction or the prism combo continue a projectile wherever it went
          // (often already out of the box), so only attack spawns are checked for aim.
          const child = (b.owner === 'prism' && b.gen > 0) || (b.owner === 'ulysses' && (b.flags & 4) !== 0);
          if (displaced && !child) {
            displacedSpawns++;
            if (aimsAtBox(w, b)) tracked++;
          }
        }
        if (!b.armed) {
          goldSteps++;
          if (aabbInBand(a)) goldInBand++;
        }
      }
      for (const b of [...seen]) if (!b.active) seen.delete(b);
      w.step(STILL, STEP);
      w.soul.iframes = 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      `all four at 15, 40 s: ${spawns} spawns, ${spawnInBand} in a band; ${goldSteps} gold bullet-steps, ${goldInBand} in a band; ` +
        `box displaced ${(displacedSteps / 60).toFixed(1)} s; ${displacedSpawns} spawns while displaced, ${tracked} aimed at / formed against the box where it was`,
    );
    expect(spawnInBand).toBe(0);
    expect(goldInBand).toBe(0);
    expect(displacedSpawns).toBeGreaterThan(20);
    expect(tracked).toBe(displacedSpawns);
  });
});

/**
 * Whether a new bullet targets the box as it is now: a moving bullet's path (box-local, straight)
 * passes within the box (or the gold/forming bullet sits within 120 px of its outline, i.e. formed
 * against the current box, not the home box).
 */
function aimsAtBox(w: World, b: Bullet): boolean {
  const hw = w.box.halfWidth, hh = w.box.halfHeight;
  if (b.vx === 0 && b.vy === 0) {
    const dx = Math.max(0, Math.abs(b.x) - hw), dy = Math.max(0, Math.abs(b.y) - hh);
    return Math.hypot(dx, dy) < 120;
  }
  // Snowfall sways sideways; test its fall line with a margin of the sway amplitude.
  const pad = b.owner === 'mortimer' ? 60 : 1;
  for (let t = 0; t < 30; t += 0.01) {
    const x = b.x + b.vx * t, y = b.y + b.vy * t;
    if (Math.abs(x) <= hw + pad && Math.abs(y) <= hh + pad) return true;
  }
  return false;
}

describe('The Warden spin keeps moving', () => {
  it('never holds still for more than one swing while a spin runs (reversals included)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const w = new World(640, 369);
      const c = new Warden(w, seed);
      c.fireNow('spin', 20);
      let still = 0, maxStill = 0, last = w.box.rotation;
      for (let i = 0; i < 60 * 2.9; i++) {
        c.tick(STEP);
        w.step(STILL, STEP);
        still = Math.abs(w.box.rotation - last) < 1e-9 ? still + 1 : 0;
        maxStill = Math.max(maxStill, still);
        last = w.box.rotation;
      }
      expect(maxStill, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });
});
