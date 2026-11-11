import { DEFAULT_STYLE, emit, type BulletStyle, type Spawner } from './types';

export interface RingOptions {
  x: number;
  y: number;
  count: number;
  speed: number;
  /** Rotation of the first bullet, radians. */
  angleOffset?: number;
  /** Start this far from the center (px). */
  radius?: number;
  style?: Partial<BulletStyle>;
}

/** Bullets evenly spaced around a full circle, moving outward. */
export function ring(target: Spawner, o: RingOptions): number {
  const style = { ...DEFAULT_STYLE, ...o.style };
  const r0 = o.radius ?? 0;
  let n = 0;
  for (let i = 0; i < o.count; i++) {
    const a = (o.angleOffset ?? 0) + (i / o.count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (emit(target, { ...style, x: o.x + c * r0, y: o.y + s * r0, vx: c * o.speed, vy: s * o.speed })) n++;
  }
  return n;
}
