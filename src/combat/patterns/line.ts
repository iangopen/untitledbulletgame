import type { Box } from '../../core/Box';
import type { Wall } from '../Bullet';
import { DEFAULT_STYLE, emit, type BulletStyle, type Spawner } from './types';

export interface LineOptions {
  /** Edge the bullets come from; they travel across the box away from it. */
  edge: Wall;
  count: number;
  speed: number;
  /** Indices to leave empty (the safe gap). */
  gaps?: number[];
  /** Distance outside the edge where bullets start (px). Default 12. */
  offset?: number;
  style?: Partial<BulletStyle>;
}

/** A row of bullets evenly spread along one box edge, all moving inward. Returns how many spawned. */
export function line(target: Spawner, box: Box, o: LineOptions): number {
  const style = { ...DEFAULT_STYLE, ...o.style };
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  const off = o.offset ?? 12;
  const horizontalEdge = o.edge === 'top' || o.edge === 'bottom';
  const span = horizontalEdge ? hw * 2 : hh * 2;
  const step = span / o.count;
  const dir = o.edge === 'left' || o.edge === 'top' ? 1 : -1;
  let n = 0;
  for (let i = 0; i < o.count; i++) {
    if (o.gaps?.includes(i)) continue;
    const along = -span / 2 + step * (i + 0.5);
    const x = horizontalEdge ? along : -dir * (hw + off);
    const y = horizontalEdge ? -dir * (hh + off) : along;
    const vx = horizontalEdge ? 0 : dir * o.speed;
    const vy = horizontalEdge ? dir * o.speed : 0;
    if (emit(target, { ...style, x, y, vx, vy })) n++;
  }
  return n;
}
