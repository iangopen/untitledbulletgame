import type { Box, Vec2 } from '../core/Box';
import type { Bullet } from '../combat/Bullet';
import { px } from '../tuning';

/**
 * Render interpolation (pure, no Phaser).
 *
 * Logic runs on the fixed 60 Hz step and every object keeps its pre-step state (`prev`/`px`/`prot`).
 * Drawing blends prev -> current by `alpha`, the leftover fraction of a step in the clock's
 * accumulator, so motion is even at any refresh rate. The drawn state trails the simulated state
 * by less than one step; collision and logic never read interpolated values.
 *
 * Teleports are never smeared: a jump larger than SNAP_DISTANCE or a turn larger than SNAP_ANGLE in
 * one step draws at the current state (bounces, relocations). Spawns and resets start with
 * prev == current, so they draw exactly where they are.
 */
export const SNAP_DISTANCE = px(40);
export const SNAP_ANGLE = Math.PI / 2;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-way angle blend; snaps to `b` for a turn above SNAP_ANGLE. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) > SNAP_ANGLE) return b;
  return b - d * (1 - t);
}

/** Interpolated point; snaps to the current position after a teleport. */
export function lerpPoint(px0: number, py0: number, x: number, y: number, t: number, out: Vec2): Vec2 {
  const dx = x - px0;
  const dy = y - py0;
  // t >= 1 is exactly the simulated state (no rounding), so the hitbox overlay matches to the bit.
  if (t >= 1 || dx * dx + dy * dy > SNAP_DISTANCE * SNAP_DISTANCE) {
    out.x = x;
    out.y = y;
  } else {
    out.x = px0 + dx * t;
    out.y = py0 + dy * t;
  }
  return out;
}

/** Copy a bullet's drawable fields into `out` at its interpolated position and rotation. */
export function interpBullet(b: Bullet, t: number, out: Bullet): Bullet {
  out.shape = b.shape;
  out.a = b.a;
  out.b = b.b;
  out.age = b.age;
  out.noPop = b.noPop;
  out.kind = b.kind;
  lerpPoint(b.px, b.py, b.x, b.y, t, out);
  out.rotation = lerpAngle(b.prot, b.rotation, t);
  return out;
}

/** The box's geometry at a blend between its pre-step and current state, with the same transforms. */
export class BoxFrame {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  rotation = 0;
  private c = 1;
  private s = 0;

  get halfWidth(): number {
    return this.width / 2;
  }
  get halfHeight(): number {
    return this.height / 2;
  }

  /** Box rotation is accumulated (no wrap), so it blends linearly like the other tracks. */
  set(box: Box, t: number): this {
    const p = t >= 1 ? box : box.prev;
    this.x = lerp(p.x, box.x, t);
    this.y = lerp(p.y, box.y, t);
    this.width = lerp(p.width, box.width, t);
    this.height = lerp(p.height, box.height, t);
    this.rotation = lerp(p.rotation, box.rotation, t);
    this.c = Math.cos(this.rotation);
    this.s = Math.sin(this.rotation);
    return this;
  }

  toWorld(local: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const lx = local.x;
    const ly = local.y;
    out.x = this.x + lx * this.c - ly * this.s;
    out.y = this.y + lx * this.s + ly * this.c;
    return out;
  }
}
