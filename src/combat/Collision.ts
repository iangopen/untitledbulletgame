/** Pure shape-vs-shape tests. All inputs share one coordinate frame (box-local). */

/** Touching counts as a hit; EPS absorbs float error from rotations so exact edge contact is stable. */
export const EPS = 1e-6;

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Rectangle by center, half extents and rotation (radians). */
export interface Rect {
  x: number;
  y: number;
  hw: number;
  hh: number;
  rotation?: number;
}

export interface Triangle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
}

/** Touching counts as overlap. */
export function circleVsCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr + EPS;
}

export function circleVsRect(c: Circle, rect: Rect): boolean {
  let dx = c.x - rect.x;
  let dy = c.y - rect.y;
  const rot = rect.rotation ?? 0;
  if (rot !== 0) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    dx = lx;
    dy = ly;
  }
  const qx = Math.min(rect.hw, Math.max(-rect.hw, dx));
  const qy = Math.min(rect.hh, Math.max(-rect.hh, dy));
  const ex = dx - qx;
  const ey = dy - qy;
  return ex * ex + ey * ey <= c.r * c.r + EPS;
}

/** Squared distance from point P to segment AB. */
export function distSqPointSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len = abx * abx + aby * aby;
  let t = len === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t - px;
  const qy = ay + aby * t - py;
  return qx * qx + qy * qy;
}

export function pointInTriangle(px: number, py: number, t: Triangle): boolean {
  const d1 = (px - t.bx) * (t.ay - t.by) - (t.ax - t.bx) * (py - t.by);
  const d2 = (px - t.cx) * (t.by - t.cy) - (t.bx - t.cx) * (py - t.cy);
  const d3 = (px - t.ax) * (t.cy - t.ay) - (t.cx - t.ax) * (py - t.ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Works for either winding order. */
export function circleVsTriangle(c: Circle, t: Triangle): boolean {
  if (pointInTriangle(c.x, c.y, t)) return true;
  const r2 = c.r * c.r + EPS;
  return (
    distSqPointSegment(c.x, c.y, t.ax, t.ay, t.bx, t.by) <= r2 ||
    distSqPointSegment(c.x, c.y, t.bx, t.by, t.cx, t.cy) <= r2 ||
    distSqPointSegment(c.x, c.y, t.cx, t.cy, t.ax, t.ay) <= r2
  );
}
