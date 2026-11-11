import { bulletCircle, bulletRect, bulletTriangle, type Bullet } from './Bullet';
import { circleVsCircle, circleVsRect, circleVsTriangle, type Circle, type Rect, type Triangle } from './Collision';

const sc: Circle = { x: 0, y: 0, r: 0 };
const sr: Rect = { x: 0, y: 0, hw: 0, hh: 0, rotation: 0 };
const st: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };

/** Does this bullet's exact (drawn) shape touch the circle? Both in box-local space. */
export function bulletHitsCircle(b: Bullet, c: Circle): boolean {
  switch (b.shape) {
    case 'circle':
      return circleVsCircle(c, bulletCircle(b, sc));
    case 'rect':
    case 'beam':
      return circleVsRect(c, bulletRect(b, sr));
    case 'triangle':
      return circleVsTriangle(c, bulletTriangle(b, st));
  }
}
