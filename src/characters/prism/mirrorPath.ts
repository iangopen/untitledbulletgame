import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';

/**
 * Pure geometry for Prism's Mirrors (world space, no Phaser). The beam's path is a polyline from an
 * off-screen start through every mirror's center to an off-screen end; each mirror's surface is
 * turned so the incoming leg reflects exactly into the outgoing one. Drawing (mirror angles), the
 * beam's motion and its hitbox all come from this one polyline.
 */
export interface Pt {
  x: number;
  y: number;
}

/** Distance along (dx, dy) (unit) from (x, y) until the point leaves the screen grown by `margin`. */
export function screenExitDistance(x: number, y: number, dx: number, dy: number, margin: number): number {
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (SCREEN_WIDTH + margin - x) / dx);
  if (dx < -1e-9) t = Math.min(t, (-margin - x) / dx);
  if (dy > 1e-9) t = Math.min(t, (SCREEN_HEIGHT + margin - y) / dy);
  if (dy < -1e-9) t = Math.min(t, (-margin - y) / dy);
  return Math.max(0, t);
}

/** Surface angle (rad) of a mirror at `m` that reflects a beam arriving from `prev` toward `next`. */
export function mirrorAngle(prev: Pt, m: Pt, next: Pt): number {
  const ix = m.x - prev.x, iy = m.y - prev.y;
  const ox = next.x - m.x, oy = next.y - m.y;
  const il = Math.hypot(ix, iy) || 1, ol = Math.hypot(ox, oy) || 1;
  // The normal bisects the turn: out - in (both unit). The surface is perpendicular to it.
  const nx = ox / ol - ix / il, ny = oy / ol - iy / il;
  return Math.atan2(ny, nx) + Math.PI / 2;
}

/** Reflect the unit direction (dx, dy) off a surface at angle `surface`. */
export function reflect(dx: number, dy: number, surface: number): Pt {
  const nx = -Math.sin(surface), ny = Math.cos(surface);
  const d = dx * nx + dy * ny;
  return { x: dx - 2 * d * nx, y: dy - 2 * d * ny };
}

/** Total length of a polyline. */
export function pathLength(path: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return L;
}

/** The point at distance `s` along a polyline and the unit direction of its leg there (clamped to the ends). */
export function pointAt(path: readonly Pt[], s: number): { x: number; y: number; dx: number; dy: number } {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= 1e-9) continue;
    const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
    if (left <= L || i === path.length - 1) {
      const t = Math.min(left, L);
      return { x: a.x + dx * t, y: a.y + dy * t, dx, dy };
    }
    left -= L;
  }
  const p = path[0]!;
  return { x: p.x, y: p.y, dx: 1, dy: 0 };
}
