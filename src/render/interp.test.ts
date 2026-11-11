import { describe, expect, it } from 'vitest';
import { Clock, STEP } from '../core/Clock';
import { World } from '../core/World';
import { Bullet } from '../combat/Bullet';
import { BoxFrame, SNAP_DISTANCE, interpBullet, lerpAngle, lerpPoint } from './interp';
import { SOUL_SPEED } from '../tuning';

/**
 * Feed the real Clock and World at a display refresh rate with the soul holding "right",
 * and record the soul's drawn x per frame, with and without interpolation.
 */
function pace(hz: number, frames: number, jitterMs = 0) {
  const w = new World(640, 360);
  w.soul.pos.x = -200;
  w.soul.snapshot();
  const clock = new Clock();
  const input = { dx: 1, dy: 0, slow: false };
  const hist = [0, 0, 0, 0];
  const raw: number[] = [];
  const smooth: number[] = [];
  const out = { x: 0, y: 0 };
  let seed = 7;
  for (let i = 0; i < frames; i++) {
    seed = (seed * 16807) % 2147483647;
    const j = jitterMs ? ((seed / 2147483647) * 2 - 1) * jitterMs : 0;
    const n = clock.advance((1000 / hz + j) / 1000);
    hist[Math.min(3, n)]!++;
    for (let k = 0; k < n; k++) w.step(input, STEP);
    const s = w.soul;
    raw.push(w.box.toWorld(s.pos).x);
    const f = new BoxFrame().set(w.box, clock.alpha);
    smooth.push(f.toWorld(lerpPoint(s.prev.x, s.prev.y, s.pos.x, s.pos.y, clock.alpha, out)).x);
  }
  const deltas = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]!);
  return { hist, raw: deltas(raw), smooth: deltas(smooth), smoothPos: smooth };
}

const spread = (d: number[]) => Math.max(...d) - Math.min(...d);

describe('render interpolation: frame pacing', () => {
  for (const hz of [60, 120, 144]) {
    it(`draws evenly spaced soul positions at ${hz} Hz`, () => {
      // Skip the first frames: the clock needs one interval to fill.
      const { hist, raw, smooth } = pace(hz, 70);
      const r = raw.slice(5);
      const s = smooth.slice(5);
      const ideal = SOUL_SPEED / hz;
      // eslint-disable-next-line no-console
      console.log(
        `${hz} Hz  steps/frame 0:${hist[0]} 1:${hist[1]} 2:${hist[2]} 3+:${hist[3]}  ` +
          `per-frame px without interp: min ${Math.min(...r).toFixed(2)} max ${Math.max(...r).toFixed(2)}  ` +
          `with: min ${Math.min(...s).toFixed(3)} max ${Math.max(...s).toFixed(3)} (ideal ${ideal.toFixed(3)})`,
      );
      for (const d of s) expect(d).toBeCloseTo(ideal, 6);
      if (hz !== 60) expect(spread(r)).toBeGreaterThan(ideal); // the judder this fixes
    });
  }

  it('logs 60 consecutive drawn soul positions at 144 Hz', () => {
    const { smoothPos, smooth } = pace(144, 66);
    const xs = smoothPos.slice(6).map((x) => x.toFixed(3));
    // eslint-disable-next-line no-console
    console.log(`144 Hz drawn x over 60 frames: ${xs.join(' ')}`);
    expect(spread(smooth.slice(6))).toBeLessThan(1e-6);
  });

  it('keeps spacing even under +-1 ms frame jitter (proportional to real time)', () => {
    const { smooth } = pace(144, 140, 1); // ~0.97 s: the soul stays clear of the right wall
    // Each drawn step equals real time x speed, so it tracks the jittered interval, never a 0/2-step pattern.
    const s = smooth.slice(5);
    const lo = (SOUL_SPEED * (1000 / 144 - 1)) / 1000;
    const hi = (SOUL_SPEED * (1000 / 144 + 1)) / 1000;
    for (const d of s) {
      expect(d).toBeGreaterThan(lo - 1e-6);
      expect(d).toBeLessThan(hi + 1e-6);
    }
  });
});

describe('render interpolation: no smearing', () => {
  it('a fresh spawn draws at its current state', () => {
    const b = new Bullet().init({ shape: 'beam', x: 30, y: -10, vx: 100, vy: 0, faceVelocity: true, a: 50, b: 6, damage: 1 });
    expect([b.px, b.py, b.prot]).toEqual([b.x, b.y, b.rotation]);
    const out = interpBullet(b, 0, new Bullet());
    expect([out.x, out.y, out.rotation]).toEqual([b.x, b.y, b.rotation]);
  });

  it('at alpha 1 (hitbox overlay on) the drawn bullet is bit-identical to the simulated one', () => {
    const b = new Bullet().init({ shape: 'triangle', x: 0.1, y: 0.2, vx: 33.3, vy: -71.7, spin: 2.9, a: 9, damage: 1 });
    b.snapshot();
    b.x += 0.7; b.y -= 1.3; b.rotation += 0.049;
    const out = interpBullet(b, 1, new Bullet());
    expect([out.x, out.y, out.rotation]).toEqual([b.x, b.y, b.rotation]);
  });

  it('a teleport draws at the new position, a small move blends', () => {
    const o = { x: 0, y: 0 };
    expect(lerpPoint(0, 0, SNAP_DISTANCE + 1, 0, 0.25, o)).toEqual({ x: SNAP_DISTANCE + 1, y: 0 });
    expect(lerpPoint(0, 0, 4, 0, 0.25, o)).toEqual({ x: 1, y: 0 });
  });

  it('angles blend the short way and snap on a flip (bounce)', () => {
    expect(Math.cos(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5))).toBeCloseTo(-1, 9); // through pi, not through 0
    expect(lerpAngle(0, Math.PI, 0.5)).toBe(Math.PI);
  });

  it('box reset and a new world have prev == current (retry never jumps)', () => {
    const w = new World(640, 360);
    w.box.moveTo(700, 300, 1);
    for (let i = 0; i < 10; i++) w.step({ dx: 1, dy: 1, slow: false }, STEP);
    w.box.reset();
    w.soul.reset();
    const f = new BoxFrame().set(w.box, 0);
    expect([f.x, f.y, f.width, f.rotation]).toEqual([w.box.x, w.box.y, w.box.width, w.box.rotation]);
    expect(w.soul.prev).toEqual(w.soul.pos);
  });

  it('logic reads only simulated state: a world drives identically with and without snapshots', () => {
    const run = (extraSnapshots: boolean) => {
      const w = new World(640, 360);
      w.box.rotateTo(1, 0.5);
      w.box.squeezeWall('left', 80, 0.4);
      for (let i = 0; i < 90; i++) {
        if (i % 7 === 0) w.pool.spawn({ shape: 'circle', x: 200, y: 0, vx: -150, vy: 10, a: 9, damage: 3 });
        w.step({ dx: -1, dy: i % 2, slow: false }, STEP);
        if (extraSnapshots) w.snapshot();
      }
      return JSON.stringify([w.soul.pos, w.soul.hp, w.box.state, w.pool.all.filter((b) => b.active).map((b) => [b.x, b.y])]);
    };
    expect(run(true)).toBe(run(false));
  });
});
