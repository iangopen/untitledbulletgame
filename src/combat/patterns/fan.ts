import { DEFAULT_STYLE, emit, type BulletStyle, type Spawner } from './types';

export interface FanOptions {
  x: number;
  y: number;
  /** Center direction in radians. */
  angle: number;
  count: number;
  /** Total angle covered, radians. count 1 ignores it. */
  spread: number;
  speed: number;
  style?: Partial<BulletStyle>;
}

/** Bullets from one point, evenly spread across `spread` around `angle`. */
export function fan(target: Spawner, o: FanOptions): number {
  const style = { ...DEFAULT_STYLE, ...o.style };
  let n = 0;
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0 : i / (o.count - 1) - 0.5;
    const a = o.angle + t * o.spread;
    if (emit(target, { ...style, x: o.x, y: o.y, vx: Math.cos(a) * o.speed, vy: Math.sin(a) * o.speed })) n++;
  }
  return n;
}
