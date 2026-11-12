import { describe, expect, it } from 'vitest';
import { BulletPool } from './BulletPool';
import { bulletHitsCircle } from './hitTest';
import { bulletPrimitives, curvedStreak, makeForm, type Primitive } from './composite';
import { bulletExtent } from './Bullet';

// A "T": a long bar along +x and a short crossbar at x = 10, plus a round knob at the origin.
const T = makeForm([
  { kind: 'rect', x: 30, y: 0, hw: 20, hh: 2 },
  { kind: 'rect', x: 10, y: 0, hw: 2, hh: 8 },
  { kind: 'circle', x: 0, y: 0, r: 3 },
]);

function spawn(rotation: number, scale = 1) {
  const p = new BulletPool(2);
  const b = p.spawn({ shape: 'composite', form: T, x: 100, y: 50, rotation, a: 0, damage: 1, noPop: scale === 1 })!;
  return b;
}
const at = (b: { x: number; y: number; rotation: number }, lx: number, ly: number) => ({
  x: b.x + lx * Math.cos(b.rotation) - ly * Math.sin(b.rotation),
  y: b.y + lx * Math.sin(b.rotation) + ly * Math.cos(b.rotation),
});

describe('composite shapes', () => {
  it('extent covers every part', () => {
    // The farthest corner of the bar is (50, 2); the extent may round up but must cover it.
    expect(T.extent).toBeGreaterThanOrEqual(Math.hypot(50, 2));
    expect(T.extent).toBeLessThan(51);
    expect(bulletExtent({ shape: 'composite', a: 0, form: T })).toBe(T.extent);
  });

  for (const rot of [0, Math.PI / 2, 0.7, -2.3]) {
    it(`hits each part and misses the gaps between them (rotation ${rot.toFixed(2)})`, () => {
      const b = spawn(rot);
      const probe = (lx: number, ly: number) => bulletHitsCircle(b, { ...at(b, lx, ly), r: 0.25 });
      // Bar: tip and edges.
      expect(probe(49.7, 0)).toBe(true);
      expect(probe(50.3, 0)).toBe(false);
      expect(probe(30, 1.7)).toBe(true);
      expect(probe(30, 2.3)).toBe(false);
      // Crossbar sticks out sideways; the bar doesn't there.
      expect(probe(10, 7.7)).toBe(true);
      expect(probe(10, 8.3)).toBe(false);
      expect(probe(30, 7.7)).toBe(false);
      // Knob.
      expect(probe(-2.7, 0)).toBe(true);
      expect(probe(-3.3, 0)).toBe(false);
      // Behind the knob, beside the crossbar: empty.
      expect(probe(-1, 6)).toBe(false);
    });
  }

  it('drawing and collision see the same primitives (one definition)', () => {
    const b = spawn(0.4);
    const seen: string[] = [];
    bulletPrimitives(b, (p: Primitive) => void seen.push(p.kind));
    expect(seen).toEqual(['rect', 'rect', 'circle']);
  });

  it('parts scale with the bullet (spawn pop / grow-in) about its origin', () => {
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'composite', form: T, x: 0, y: 0, a: 0, damage: 1, armDelay: 1, growIn: true })!;
    b.age = 0.5; // half grown
    expect(b.scale).toBeCloseTo(0.5);
    const tips: number[] = [];
    bulletPrimitives(b, (q) => void (q.kind === 'rect' && tips.push(q.r.x + q.r.hw)));
    expect(tips[0]).toBeCloseTo(25);
  });

  it('curved streak: a chain of rects following the curve, joints covered', () => {
    const parts = curvedStreak(60, 4, 10, 6);
    expect(parts).toHaveLength(6);
    const f = makeForm(parts);
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'composite', form: f, x: 0, y: 0, a: 0, damage: 1, noPop: true })!;
    // On the curve everywhere along it (y = 10 sin(pi t) - 5), off it 4 px away.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const x = (t - 0.5) * 60;
      const y = 10 * Math.sin(Math.PI * t) - 5;
      expect(bulletHitsCircle(b, { x, y, r: 0.5 })).toBe(true);
      if (i > 1 && i < 19) expect(bulletHitsCircle(b, { x, y: y + 4.5, r: 0.5 })).toBe(false);
    }
  });
});
