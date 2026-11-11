import type { Box } from '../../core/Box';
import { bulletExtent, type Wall } from '../Bullet';
import { edgeOffscreenOffset } from '../offscreen';
import { DEFAULT_STYLE, emit, type BulletStyle, type Spawner } from './types';

export interface LineOptions {
  /** Edge the bullets come from; they travel across the box away from it. */
  edge: Wall;
  /**
   * Slot layout, one of:
   *  - count: that many slots spread evenly along the whole edge;
   *  - spacing: a constant distance between neighbouring slots; as many slots as fit on the edge,
   *    centered (so spacing never changes with box size or level).
   */
  count?: number;
  spacing?: number;
  speed: number;
  /** Slot indices to leave empty. */
  gaps?: number[];
  /** Or: one contiguous safe gap of `gapSize` slots, starting at fraction `gapAt` (0..1) of the free range. */
  gapSize?: number;
  gapAt?: number;
  /** Distance beyond the box edge where the row starts (px). Default: just off screen (see offscreen.ts). */
  offset?: number;
  style?: Partial<BulletStyle>;
}

/** Slot count for an edge: from `count`, or how many `spacing`-apart slots fit along it. */
export function lineSlots(box: Box, o: Pick<LineOptions, 'edge' | 'count' | 'spacing'>): number {
  if (o.spacing && o.spacing > 0) {
    const span = o.edge === 'top' || o.edge === 'bottom' ? box.width : box.height;
    return Math.max(1, Math.floor(span / o.spacing));
  }
  return Math.max(1, o.count ?? 1);
}

/** Distance (px) a row starts beyond the edge: `offset`, or just off screen for this style. */
export function lineOffset(box: Box, o: Pick<LineOptions, 'edge' | 'offset' | 'style'>): number {
  if (o.offset !== undefined) return o.offset;
  const style = { ...DEFAULT_STYLE, ...o.style };
  return edgeOffscreenOffset(box, o.edge, bulletExtent(style));
}

/** A row of bullets along one box edge, all moving inward. Returns how many spawned. */
export function line(target: Spawner, box: Box, o: LineOptions): number {
  const style = { ...DEFAULT_STYLE, ...o.style };
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  const off = lineOffset(box, o);
  const horizontalEdge = o.edge === 'top' || o.edge === 'bottom';
  const span = horizontalEdge ? hw * 2 : hh * 2;
  const count = lineSlots(box, o);
  const step = o.spacing && o.spacing > 0 ? o.spacing : span / count;
  const dir = o.edge === 'left' || o.edge === 'top' ? 1 : -1;
  const skip = new Set(o.gaps ?? []);
  if (o.gapSize && o.gapSize > 0) {
    const free = Math.max(0, count - o.gapSize);
    const start = Math.min(free, Math.floor((o.gapAt ?? 0.5) * (free + 1)));
    for (let i = 0; i < o.gapSize; i++) skip.add(start + i);
  }
  let n = 0;
  for (let i = 0; i < count; i++) {
    if (skip.has(i)) continue;
    const along = (i - (count - 1) / 2) * step;
    const x = horizontalEdge ? along : -dir * (hw + off);
    const y = horizontalEdge ? -dir * (hh + off) : along;
    const vx = horizontalEdge ? 0 : dir * o.speed;
    const vy = horizontalEdge ? dir * o.speed : 0;
    if (emit(target, { ...style, x, y, vx, vy })) n++;
  }
  return n;
}
