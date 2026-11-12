import type { Bullet } from './Bullet';
import { circleVsCircle, circleVsRect, circleVsTriangle, type Circle } from './Collision';
import { bulletPrimitives } from './composite';

/**
 * Does this bullet's exact (drawn) shape touch the circle? Both in box-local space. Goes through
 * the same primitives the renderer draws (bulletPrimitives), composites included.
 */
export function bulletHitsCircle(b: Bullet, c: Circle): boolean {
  return bulletPrimitives(b, (p) =>
    p.kind === 'circle' ? circleVsCircle(c, p.c) : p.kind === 'rect' ? circleVsRect(c, p.r) : circleVsTriangle(c, p.t),
  );
}
