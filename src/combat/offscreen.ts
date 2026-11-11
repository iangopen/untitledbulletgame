import type { Box, Vec2, Wall } from '../core/Box';
import { OFFSCREEN_PAD, SCREEN_HEIGHT, SCREEN_WIDTH } from '../tuning';

/**
 * Off-screen spawning (pure). Attacks start beyond the edge of the visible screen and travel in.
 * Positions are box-local like every bullet; the box may be moved or rotated, so distances are
 * measured as rays in world space against the screen rect.
 */

/** Outward unit normal of each box edge, box-local. */
export const OUTWARD: Record<Wall, Vec2> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

const tmp: Vec2 = { x: 0, y: 0 };

/**
 * How far to go from box-local point (x, y) along box-local direction (dx, dy) until the point
 * is outside the screen by `margin` px. 0 if it already is.
 */
export function exitDistance(box: Box, x: number, y: number, dx: number, dy: number, margin: number): number {
  tmp.x = x;
  tmp.y = y;
  const o = box.toWorld(tmp, { x: 0, y: 0 });
  const c = Math.cos(box.rotation);
  const s = Math.sin(box.rotation);
  const len = Math.hypot(dx, dy) || 1;
  const wx = (dx * c - dy * s) / len;
  const wy = (dx * s + dy * c) / len;
  const minX = -margin;
  const maxX = SCREEN_WIDTH + margin;
  const minY = -margin;
  const maxY = SCREEN_HEIGHT + margin;
  if (o.x < minX || o.x > maxX || o.y < minY || o.y > maxY) return 0;
  let t = Infinity;
  if (wx > 1e-12) t = Math.min(t, (maxX - o.x) / wx);
  else if (wx < -1e-12) t = Math.min(t, (minX - o.x) / wx);
  if (wy > 1e-12) t = Math.min(t, (maxY - o.y) / wy);
  else if (wy < -1e-12) t = Math.min(t, (minY - o.y) / wy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** Margin past the screen edge for a bullet of this extent (its farthest point from its center). */
export function offscreenMargin(extent: number): number {
  return extent + OFFSCREEN_PAD;
}

/**
 * Distance beyond a box edge (along its outward normal) at which a whole row along that edge is
 * off screen: the larger of the two edge corners, so the row stays straight.
 */
export function edgeOffscreenOffset(box: Box, edge: Wall, extent: number): number {
  const n = OUTWARD[edge];
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  const m = offscreenMargin(extent);
  const corners: [number, number][] =
    edge === 'left' || edge === 'right'
      ? [[n.x * hw, -hh], [n.x * hw, hh]]
      : [[-hw, n.y * hh], [hw, n.y * hh]];
  return Math.max(...corners.map(([x, y]) => exitDistance(box, x, y, n.x, n.y, m)));
}

/**
 * Start point for a projectile that should cross box-local point (x, y) heading at `angle`:
 * backed out along its path until it is off screen. Returns the start and the distance to (x, y).
 */
export function offscreenStart(box: Box, x: number, y: number, angle: number, extent: number): { x: number; y: number; distance: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const d = exitDistance(box, x, y, -dx, -dy, offscreenMargin(extent));
  return { x: x - dx * d, y: y - dy * d, distance: d };
}

/** Upper bound on any off-screen start distance from the box (farthest screen corner + margin). */
export function maxOffscreenDistance(box: Box, extent: number): number {
  const m = offscreenMargin(extent);
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  let best = 0;
  for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
    tmp.x = lx;
    tmp.y = ly;
    const p = box.toWorld(tmp, { x: 0, y: 0 });
    for (const [sx, sy] of [[-m, -m], [SCREEN_WIDTH + m, -m], [SCREEN_WIDTH + m, SCREEN_HEIGHT + m], [-m, SCREEN_HEIGHT + m]] as const) {
      best = Math.max(best, Math.hypot(sx - p.x, sy - p.y));
    }
  }
  return best;
}
