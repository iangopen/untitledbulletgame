import { describe, expect, it, vi } from 'vitest';
import { BulletPool } from './BulletPool';
import { Box } from '../core/Box';
import { aimed, fan, line, ring } from './patterns';
import { DESPAWN_MARGIN, SOUL_RADIUS } from '../tuning';
import { World } from '../core/World';

const box = new Box(320, 240, 300, 200);
const active = (p: BulletPool) => p.all.filter((b) => b.active);

describe('BulletPool', () => {
  it('acquire / release reuse the same preallocated objects', () => {
    const p = new BulletPool(4);
    const a = p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 })!;
    expect(p.activeCount).toBe(1);
    expect(p.all).toContain(a);
    p.release(a);
    expect(p.activeCount).toBe(0);
    const b = p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 })!;
    expect(b).toBe(a);
  });
  it('fails gracefully past capacity and counts drops', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new BulletPool(3);
    for (let i = 0; i < 5; i++) p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 });
    expect(p.activeCount).toBe(3);
    expect(p.dropped).toBe(2);
    expect(p.acquire()).toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });
  it('double release is a no-op', () => {
    const p = new BulletPool(2);
    const a = p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 })!;
    p.release(a);
    p.release(a);
    expect(p.activeCount).toBe(0);
    p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 });
    p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1 });
    expect(p.acquire()).toBeNull();
  });
  it('despawns on lifetime end', () => {
    const p = new BulletPool(2);
    const reasons: string[] = [];
    p.onDespawn = (_b, r) => reasons.push(r);
    p.spawn({ shape: 'circle', x: 0, y: 0, a: 5, damage: 1, lifetime: 0.1 });
    for (let i = 0; i < 5; i++) p.update(1 / 60, box);
    expect(p.activeCount).toBe(1);
    for (let i = 0; i < 2; i++) p.update(1 / 60, box);
    expect(p.activeCount).toBe(0);
    expect(reasons).toEqual(['lifetime']);
  });
  it('despawns once beyond the box by the margin, not before', () => {
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'circle', x: 150 + DESPAWN_MARGIN - 1, y: 0, vx: 0, a: 5, damage: 1 })!;
    p.update(1 / 60, box);
    expect(b.active).toBe(true);
    b.x = 150 + DESPAWN_MARGIN + 0.5;
    p.update(1 / 60, box);
    expect(b.active).toBe(false);
  });
  it('wall hook fires once on inside -> outside, with the right wall; die/bounce/pass', () => {
    const p = new BulletPool(8);
    const walls: string[] = [];
    const die = p.spawn({ shape: 'circle', x: 149, y: 0, vx: 120, a: 3, damage: 1, onWall: (_b, w) => (walls.push(w), 'die') })!;
    const bounce = p.spawn({ shape: 'circle', x: 0, y: -99, vy: -120, a: 3, damage: 1, onWall: (_b, w) => (walls.push(w), 'bounce') })!;
    const pass = p.spawn({ shape: 'circle', x: -149, y: 0, vx: -120, a: 3, damage: 1, onWall: (_b, w) => (walls.push(w), 'pass') })!;
    for (let i = 0; i < 3; i++) p.update(1 / 60, box);
    expect(walls.sort()).toEqual(['left', 'right', 'top']);
    expect(die.active).toBe(false);
    expect(bounce.active).toBe(true);
    expect(bounce.vy).toBe(120);
    expect(Math.abs(bounce.y)).toBeLessThanOrEqual(100);
    expect(pass.active).toBe(true);
    expect(pass.x).toBeLessThan(-150);
  });
  it('bullets spawned outside and flying in do not trigger the wall hook', () => {
    const p = new BulletPool(2);
    let calls = 0;
    p.spawn({ shape: 'circle', x: -160, y: 0, vx: 600, a: 3, damage: 1, onWall: () => (calls++, 'die') });
    for (let i = 0; i < 10; i++) p.update(1 / 60, box);
    expect(calls).toBe(0);
  });
  it('wall hook can spawn children through the context (split)', () => {
    const p = new BulletPool(8);
    p.spawn({
      shape: 'beam', x: 149, y: 0, vx: 120, a: 10, b: 2, damage: 1,
      onWall: (b, _w, ctx) => {
        ctx.spawn({ shape: 'beam', x: b.x, y: b.y, vx: -100, vy: 50, a: 6, b: 2, damage: 1 });
        ctx.spawn({ shape: 'beam', x: b.x, y: b.y, vx: -100, vy: -50, a: 6, b: 2, damage: 1 });
        return 'die';
      },
    });
    p.update(1 / 60, box);
    expect(active(p).map((b) => [Math.sign(b.vx), Math.sign(b.vy)])).toEqual([[-1, 1], [-1, -1]]);
  });
  it('step hook runs each step and can change motion', () => {
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'circle', x: 0, y: 0, a: 3, damage: 1, onStep: (b, dt) => (b.vx += 60 * dt) })!;
    for (let i = 0; i < 60; i++) p.update(1 / 60, box);
    expect(b.vx).toBeCloseTo(60);
  });
});

describe('patterns', () => {
  it('line from left: evenly spaced along the edge, outside it, moving right, gaps skipped', () => {
    const p = new BulletPool(32);
    const n = line(p, box, { edge: 'left', count: 4, speed: 100, gaps: [1], offset: 10 });
    expect(n).toBe(3);
    const bs = active(p);
    expect(bs.map((b) => b.y)).toEqual([-75, 25, 75]);
    for (const b of bs) {
      expect(b.x).toBe(-160);
      expect([b.vx, b.vy]).toEqual([100, 0]);
    }
  });
  it('line from each edge travels inward', () => {
    for (const [edge, vx, vy] of [['right', -1, 0], ['top', 0, 1], ['bottom', 0, -1]] as const) {
      const p = new BulletPool(32);
      line(p, box, { edge, count: 3, speed: 50 });
      for (const b of active(p)) {
        expect(Math.sign(b.vx)).toBe(vx);
        expect(Math.sign(b.vy)).toBe(vy);
        // Starts outside the interior on that edge
        expect(Math.abs(edge === 'right' ? b.x : b.y)).toBeGreaterThan(edge === 'right' ? 150 : 100);
      }
    }
  });
  it('fan spreads symmetrically around the angle at the given speed', () => {
    const p = new BulletPool(32);
    fan(p, { x: 5, y: 6, angle: 0, count: 3, spread: Math.PI / 2, speed: 100 });
    const angles = active(p).map((b) => Math.atan2(b.vy, b.vx));
    expect(angles[0]).toBeCloseTo(-Math.PI / 4);
    expect(angles[1]).toBeCloseTo(0);
    expect(angles[2]).toBeCloseTo(Math.PI / 4);
    for (const b of active(p)) {
      expect([b.x, b.y]).toEqual([5, 6]);
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(100);
    }
  });
  it('ring spaces bullets evenly over a full circle, starting at radius', () => {
    const p = new BulletPool(32);
    ring(p, { x: 0, y: 0, count: 4, speed: 50, radius: 10 });
    const bs = active(p);
    const pos = bs.map((b) => [Math.round(b.x) + 0, Math.round(b.y) + 0]);
    expect(pos).toEqual([[10, 0], [0, 10], [-10, 0], [0, -10]]);
    for (const b of bs) {
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(50);
      // velocity points outward
      expect(b.vx * b.x + b.vy * b.y).toBeGreaterThan(0);
    }
  });
  it('aimed points at the target; multi-shot centers on it', () => {
    const p = new BulletPool(32);
    aimed(p, { x: 0, y: 0, target: { x: 30, y: 40 }, speed: 50 });
    const [b] = active(p);
    expect(b!.vx).toBeCloseTo(30);
    expect(b!.vy).toBeCloseTo(40);
    const q = new BulletPool(32);
    aimed(q, { x: 0, y: 0, target: { x: 0, y: 10 }, speed: 10, count: 3, spread: 0.4 });
    expect(Math.atan2(active(q)[1]!.vy, active(q)[1]!.vx)).toBeCloseTo(Math.PI / 2);
  });
  it('pattern style carries shape, damage and type', () => {
    const p = new BulletPool(32);
    ring(p, { x: 0, y: 0, count: 2, speed: 1, style: { shape: 'triangle', a: 7, damage: 9, kind: 'kr', owner: 'prism' } });
    for (const b of active(p)) expect([b.shape, b.a, b.damage, b.kind, b.owner]).toEqual(['triangle', 7, 9, 'kr', 'prism']);
  });
  it('patterns report fewer spawns when the pool is full', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new BulletPool(5);
    expect(ring(p, { x: 0, y: 0, count: 8, speed: 1 })).toBe(5);
    warn.mockRestore();
  });
});

describe('World: bullets damage the soul only through Soul.damage', () => {
  it('a touching bullet hits once, then i-frames block', () => {
    const w = new World(0, 0);
    const still = { dx: 0, dy: 0, slow: false };
    w.pool.spawn({ shape: 'circle', x: 0, y: 0, a: 4, damage: 10, noPop: true });
    w.step(still, 1 / 60);
    expect(w.soul.hp).toBe(90);
    w.step(still, 1 / 60);
    expect(w.soul.hp).toBe(90);
    expect(w.soul.invulnerable).toBe(true);
  });
  it('a near miss (0.01 px gap) does not hit', () => {
    const w = new World(0, 0);
    // soul radius + bullet r 4, plus a 0.01 px gap
    w.pool.spawn({ shape: 'circle', x: SOUL_RADIUS + 4 + 0.01, y: 0, a: 4, damage: 10, noPop: true });
    w.step({ dx: 0, dy: 0, slow: false }, 1 / 60);
    expect(w.soul.hp).toBe(100);
  });
  it('KR bullets fill the pool instead of hitting HP (rules unchanged)', () => {
    const w = new World(0, 0);
    w.pool.spawn({ shape: 'rect', x: 0, y: 0, a: 20, b: 2, damage: 15, kind: 'kr', noPop: true });
    w.step({ dx: 0, dy: 0, slow: false }, 1 / 60);
    expect(w.soul.kr).toBeGreaterThan(14);
    expect(w.soul.hp).toBeGreaterThan(99);
  });
});
