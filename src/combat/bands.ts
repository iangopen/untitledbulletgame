import type { Box } from '../core/Box';
import { hud, VIEW } from '../render/theme';
import { rectCorners, type Bullet } from './Bullet';
import { bulletPrimitives } from './composite';

/**
 * HUD-band geometry (pure). No attack may spawn or form (pre-active stage) inside a HUD band
 * (render/theme.ts `hud`); characters use these to keep that true while the box is displaced.
 */
export interface Aabb {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const corners = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
const tmp = { x: 0, y: 0 };

/** World-space AABB of a bullet's exact, full-size shape (every primitive). */
export function bulletWorldAabb(box: Box, b: Bullet): Aabb {
  const a: Aabb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x: number, y: number, r = 0) => {
    tmp.x = x;
    tmp.y = y;
    const p = box.toWorld(tmp, tmp);
    a.x0 = Math.min(a.x0, p.x - r); a.x1 = Math.max(a.x1, p.x + r);
    a.y0 = Math.min(a.y0, p.y - r); a.y1 = Math.max(a.y1, p.y + r);
  };
  bulletPrimitives(b, (p) => {
    if (p.kind === 'circle') add(p.c.x, p.c.y, p.c.r);
    else if (p.kind === 'tri') { add(p.t.ax, p.t.ay); add(p.t.bx, p.t.by); add(p.t.cx, p.t.cy); }
    else for (const q of rectCorners(p.r, corners)) add(q.x, q.y);
  });
  return a;
}

/** Whether an AABB touches either HUD band (only the part on screen counts). */
export function aabbInBand(a: Aabb): boolean {
  if (a.x1 < 0 || a.x0 > VIEW.width) return false;
  return [hud.top, hud.bottom].some((b) => a.y1 >= b.y && a.y0 <= b.y + b.height);
}

/** The play area between the HUD bands (world y range), where boxes and forming attacks live. */
export const PLAY_TOP = hud.top.y + hud.top.height;
export const PLAY_BOTTOM = hud.bottom.y;

/** Half extents of a w x h box rotated by `rot`, as an axis-aligned outline. */
export function rotatedHalfExtents(w: number, h: number, rot: number): { hx: number; hy: number } {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  return { hx: (w / 2) * c + (h / 2) * s, hy: (w / 2) * s + (h / 2) * c };
}
