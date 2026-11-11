import { px } from '../../tuning';
import type { BulletSpec } from '../Bullet';

/** Everything about a bullet except where it is and how it moves; patterns fill those in. */
export type BulletStyle = Omit<BulletSpec, 'x' | 'y' | 'vx' | 'vy'>;

export const DEFAULT_STYLE: BulletStyle = { shape: 'circle', a: px(6), damage: 5 };

/** Minimal spawn target so patterns work with the pool or a test double. */
export interface Spawner {
  spawn(spec: BulletSpec): unknown;
}

/** Spawn and report whether it succeeded (pool may be full). */
export function emit(target: Spawner, spec: BulletSpec): boolean {
  return target.spawn(spec) != null;
}
