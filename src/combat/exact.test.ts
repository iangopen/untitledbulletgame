import { describe, expect, it } from 'vitest';
import { Bullet, bulletTriangle, type BulletSpec } from './Bullet';
import { bulletHitsCircle } from './hitTest';
import { circleVsCircle, circleVsRect, circleVsTriangle } from './Collision';
import { SPAWN_POP_TIME } from '../tuning';

/** Each case: exact contact hits, 0.01 px further misses, 0.01 px closer (graze) hits. */
const D = 0.01;

const mk = (spec: Partial<BulletSpec> & Pick<BulletSpec, 'shape' | 'a'>): Bullet => {
  const b = new Bullet().init({ x: 0, y: 0, damage: 1, noPop: true, ...spec });
  return b;
};

describe('circle vs circle: edge, near-miss, graze', () => {
  const r = 6;
  const b = { x: 0, y: 0, r: 4 };
  it('axis-aligned', () => {
    expect(circleVsCircle({ x: 10, y: 0, r }, b)).toBe(true);
    expect(circleVsCircle({ x: 10 + D, y: 0, r }, b)).toBe(false);
    expect(circleVsCircle({ x: 10 - D, y: 0, r }, b)).toBe(true);
  });
  it('diagonal', () => {
    const at = (d: number) => ({ x: (3 / 5) * d, y: (4 / 5) * d, r });
    expect(circleVsCircle(at(10), b)).toBe(true);
    expect(circleVsCircle(at(10 + D), b)).toBe(false);
    expect(circleVsCircle(at(10 - D), b)).toBe(true);
  });
});

describe('circle vs rect: edge, near-miss, graze', () => {
  const r = 6;
  it('axis-aligned face and corner', () => {
    const rect = { x: 0, y: 0, hw: 10, hh: 2 };
    expect(circleVsRect({ x: 0, y: 8, r }, rect)).toBe(true);
    expect(circleVsRect({ x: 0, y: 8 + D, r }, rect)).toBe(false);
    expect(circleVsRect({ x: 0, y: 8 - D, r }, rect)).toBe(true);
    const k = Math.SQRT1_2;
    const corner = (d: number) => ({ x: 10 + k * d, y: 2 + k * d, r });
    expect(circleVsRect(corner(6), rect)).toBe(true);
    expect(circleVsRect(corner(6 + D), rect)).toBe(false);
    expect(circleVsRect(corner(6 - D), rect)).toBe(true);
  });
  for (const rot of [Math.PI / 4, 1.1, -2.3]) {
    it(`rotated ${rot.toFixed(2)} rad: face normal and end`, () => {
      const rect = { x: 5, y: -3, hw: 10, hh: 2, rotation: rot };
      // Local +y face normal in world: (-sin, cos)
      const nx = -Math.sin(rot);
      const ny = Math.cos(rot);
      const face = (d: number) => ({ x: 5 + nx * (2 + d), y: -3 + ny * (2 + d), r });
      expect(circleVsRect(face(6), rect)).toBe(true);
      expect(circleVsRect(face(6 + D), rect)).toBe(false);
      expect(circleVsRect(face(6 - D), rect)).toBe(true);
      // Local +x end cap
      const ex = Math.cos(rot);
      const ey = Math.sin(rot);
      const end = (d: number) => ({ x: 5 + ex * (10 + d), y: -3 + ey * (10 + d), r });
      expect(circleVsRect(end(6), rect)).toBe(true);
      expect(circleVsRect(end(6 + D), rect)).toBe(false);
      expect(circleVsRect(end(6 - D), rect)).toBe(true);
    });
  }
});

describe('circle vs triangle: edge, near-miss, graze (rotated)', () => {
  const r = 6;
  for (const rot of [0, 0.4, Math.PI / 2, -1.9]) {
    it(`rotation ${rot.toFixed(2)}: flat edge and vertex`, () => {
      const R = 10;
      const tri = bulletTriangle(mk({ shape: 'triangle', a: R, rotation: rot, x: 2, y: 3 }), {
        ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0,
      });
      // Edge opposite vertex A lies at distance R/2 from the center, in direction rot + PI.
      const ox = Math.cos(rot + Math.PI);
      const oy = Math.sin(rot + Math.PI);
      const edge = (d: number) => ({ x: 2 + ox * (R / 2 + d), y: 3 + oy * (R / 2 + d), r });
      expect(circleVsTriangle(edge(r), tri)).toBe(true);
      expect(circleVsTriangle(edge(r + D), tri)).toBe(false);
      expect(circleVsTriangle(edge(r - D), tri)).toBe(true);
      // Beyond vertex A along rot.
      const vx = Math.cos(rot);
      const vy = Math.sin(rot);
      const vert = (d: number) => ({ x: 2 + vx * (R + d), y: 3 + vy * (R + d), r });
      expect(circleVsTriangle(vert(r), tri)).toBe(true);
      expect(circleVsTriangle(vert(r + D), tri)).toBe(false);
      expect(circleVsTriangle(vert(r - D), tri)).toBe(true);
    });
  }
});

describe('bulletHitsCircle uses the drawn size for every shape', () => {
  const r = 6;
  it('circle bullet', () => {
    const b = mk({ shape: 'circle', a: 5 });
    expect(bulletHitsCircle(b, { x: 11, y: 0, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 11 + D, y: 0, r })).toBe(false);
  });
  it('rect bullet (a = half width, b = half height), rotated', () => {
    const b = mk({ shape: 'rect', a: 8, b: 3, rotation: Math.PI / 2 });
    // Rotated 90deg: long axis is vertical, so x extent is b = 3.
    expect(bulletHitsCircle(b, { x: 9, y: 0, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 9 + D, y: 0, r })).toBe(false);
    expect(bulletHitsCircle(b, { x: 0, y: 14, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 0, y: 14 + D, r })).toBe(false);
  });
  it('beam (a = full length, b = full thickness), facing velocity', () => {
    const b = mk({ shape: 'beam', a: 40, b: 4, vx: 0, vy: 50, faceVelocity: true });
    // Facing +y: length along y (half 20), thickness along x (half 2).
    expect(bulletHitsCircle(b, { x: 0, y: 26, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 0, y: 26 + D, r })).toBe(false);
    expect(bulletHitsCircle(b, { x: 8, y: 0, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 8 + D, y: 0, r })).toBe(false);
  });
  it('triangle bullet', () => {
    const b = mk({ shape: 'triangle', a: 10 });
    expect(bulletHitsCircle(b, { x: 16, y: 0, r })).toBe(true);
    expect(bulletHitsCircle(b, { x: 16 + D, y: 0, r })).toBe(false);
  });
  it('spawn pop scales the hitbox together with the drawing, never past full size', () => {
    const b = new Bullet().init({ shape: 'circle', a: 10, x: 0, y: 0, damage: 1 });
    expect(b.scale).toBeCloseTo(0.6);
    expect(bulletHitsCircle(b, { x: 12 + D, y: 0, r })).toBe(false);
    expect(bulletHitsCircle(b, { x: 12, y: 0, r })).toBe(true);
    b.age = SPAWN_POP_TIME / 2;
    expect(b.scale).toBeGreaterThan(0.6);
    expect(b.scale).toBeLessThan(1);
    b.age = SPAWN_POP_TIME;
    expect(b.scale).toBe(1);
    expect(bulletHitsCircle(b, { x: 16, y: 0, r })).toBe(true);
  });
});
