import type { DamageType } from '../core/Soul';
import type { Circle, Rect, Triangle } from './Collision';
import { SPAWN_POP_TIME } from '../tuning';

/**
 * Shapes and their size fields (a, b):
 *  - circle:   a = radius
 *  - rect:     a = half width, b = half height (along rotation)
 *  - triangle: a = circumradius (equilateral, first vertex points along rotation)
 *  - beam:     a = length, b = thickness (a long rect centered on the position)
 * Drawing AND collision both derive from these via the shape functions below,
 * so what you see is exactly what hits you.
 */
export type BulletShape = 'circle' | 'rect' | 'triangle' | 'beam';
import type { Wall } from '../core/Box';
export type { Wall };
/** What a bullet does after its center crosses a box wall from inside. */
export type WallResponse = 'pass' | 'bounce' | 'die';

/** Context passed to hooks so they can spawn (e.g. split) without importing the pool. */
export interface BulletContext {
  spawn(spec: BulletSpec): Bullet | null;
}

export type StepHook = (b: Bullet, dt: number, ctx: BulletContext) => void;
export type WallHook = (b: Bullet, wall: Wall, ctx: BulletContext) => WallResponse;

export interface BulletSpec {
  shape: BulletShape;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Radians. */
  rotation?: number;
  /** Radians per second. */
  spin?: number;
  /** Rotate to face velocity every step (beams, arrows). */
  faceVelocity?: boolean;
  a: number;
  b?: number;
  damage: number;
  type?: DamageType;
  /** Seconds; Infinity = until it leaves the box. */
  lifetime?: number;
  owner?: string;
  onStep?: StepHook;
  onWall?: WallHook;
  /** Skip the spawn pop (e.g. split children continuing a beam). */
  noPop?: boolean;
  /** Generation for splitting attacks (0 = original). Owners decide what it means. */
  gen?: number;
  /** Owner-defined bit flags (e.g. "already refracted"). */
  flags?: number;
  /** Fill color; 0 = theme default for its damage type. KR always draws magenta. */
  color?: number;
}

export class Bullet {
  active = false;
  shape: BulletShape = 'circle';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  rotation = 0;
  spin = 0;
  faceVelocity = false;
  a = 0;
  b = 0;
  damage = 0;
  type: DamageType = 'normal';
  lifetime = Infinity;
  age = 0;
  owner = '';
  onStep: StepHook | undefined = undefined;
  onWall: WallHook | undefined = undefined;
  noPop = false;
  gen = 0;
  flags = 0;
  color = 0;

  init(s: BulletSpec): this {
    this.active = true;
    this.shape = s.shape;
    this.x = s.x;
    this.y = s.y;
    this.vx = s.vx ?? 0;
    this.vy = s.vy ?? 0;
    this.faceVelocity = s.faceVelocity ?? false;
    this.rotation = this.faceVelocity ? Math.atan2(this.vy, this.vx) : (s.rotation ?? 0);
    this.spin = s.spin ?? 0;
    this.a = s.a;
    this.b = s.b ?? s.a;
    this.damage = s.damage;
    this.type = s.type ?? 'normal';
    this.lifetime = s.lifetime ?? Infinity;
    this.age = 0;
    this.owner = s.owner ?? '';
    this.onStep = s.onStep;
    this.onWall = s.onWall;
    this.noPop = s.noPop ?? false;
    this.gen = s.gen ?? 0;
    this.flags = s.flags ?? 0;
    this.color = s.color ?? 0;
    return this;
  }

  /** Spawn-pop scale; draw and hitbox both use it. Eases 0.6 -> 1 (no overshoot, so the hitbox never exceeds its final size). */
  get scale(): number {
    if (this.noPop || this.age >= SPAWN_POP_TIME) return 1;
    const t = this.age / SPAWN_POP_TIME;
    return 0.6 + 0.4 * (1 - (1 - t) * (1 - t));
  }
}

// --- Shared geometry: the single source for drawing and collision ---------

/** Rect/beam as a (possibly rotated) rect in box-local space. */
export function bulletRect(b: Bullet, out: Rect): Rect {
  const s = b.scale;
  out.x = b.x;
  out.y = b.y;
  out.rotation = b.rotation;
  if (b.shape === 'beam') {
    out.hw = (b.a / 2) * s;
    out.hh = (b.b / 2) * s;
  } else {
    out.hw = b.a * s;
    out.hh = b.b * s;
  }
  return out;
}

export function bulletCircle(b: Bullet, out: Circle): Circle {
  out.x = b.x;
  out.y = b.y;
  out.r = b.a * b.scale;
  return out;
}

export function bulletTriangle(b: Bullet, out: Triangle): Triangle {
  const r = b.a * b.scale;
  const k = (2 * Math.PI) / 3;
  const t0 = b.rotation;
  out.ax = b.x + Math.cos(t0) * r;
  out.ay = b.y + Math.sin(t0) * r;
  out.bx = b.x + Math.cos(t0 + k) * r;
  out.by = b.y + Math.sin(t0 + k) * r;
  out.cx = b.x + Math.cos(t0 + 2 * k) * r;
  out.cy = b.y + Math.sin(t0 + 2 * k) * r;
  return out;
}

const CORNER_SX = [-1, 1, 1, -1];
const CORNER_SY = [-1, -1, 1, 1];

/** Rect corners in box-local space (clockwise from top-left in the rect's frame). */
export function rectCorners(r: Rect, out: { x: number; y: number }[]): { x: number; y: number }[] {
  const c = Math.cos(r.rotation ?? 0);
  const s = Math.sin(r.rotation ?? 0);
  for (let i = 0; i < 4; i++) {
    const lx = CORNER_SX[i]! * r.hw;
    const ly = CORNER_SY[i]! * r.hh;
    const p = out[i]!;
    p.x = r.x + lx * c - ly * s;
    p.y = r.y + lx * s + ly * c;
  }
  return out;
}
