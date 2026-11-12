import { RING_SEGMENTS, type Bullet } from './Bullet';
import { circleVsCircle, circleVsRect, circleVsTriangle, type Circle } from './Collision';
import { bulletPrimitives } from './composite';

/**
 * Does this bullet's exact (drawn) shape touch the circle? Both in box-local space. Goes through
 * the same primitives the renderer draws (bulletPrimitives), composites included.
 */
export function bulletHitsCircle(b: Bullet, c: Circle): boolean {
  if (b.shape === 'ring') {
    // Quick reject: far from the ring's band (the chords sit between a cos(pi/N) and a + b/2).
    const d = Math.hypot(c.x - b.x, c.y - b.y);
    if (d > b.a + b.b * 3 + c.r + 1 || d < b.a * Math.cos(Math.PI / RING_SEGMENTS) - b.b / 2 - c.r - 1) return false;
  }
  return bulletPrimitives(b, (p) =>
    p.kind === 'circle' ? circleVsCircle(c, p.c) : p.kind === 'rect' ? circleVsRect(c, p.r) : circleVsTriangle(c, p.t),
  );
}
