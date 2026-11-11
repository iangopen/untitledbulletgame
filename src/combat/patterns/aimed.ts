import { fan } from './fan';
import type { BulletStyle, Spawner } from './types';

export interface AimedOptions {
  x: number;
  y: number;
  target: { x: number; y: number };
  speed: number;
  /** Default 1. More than one spreads as a fan centered on the target. */
  count?: number;
  spread?: number;
  style?: Partial<BulletStyle>;
}

/** Shot(s) from (x, y) aimed at a target position (usually the soul). */
export function aimed(t: Spawner, o: AimedOptions): number {
  const angle = Math.atan2(o.target.y - o.y, o.target.x - o.x);
  return fan(t, { x: o.x, y: o.y, angle, count: o.count ?? 1, spread: o.spread ?? 0, speed: o.speed, style: o.style });
}
