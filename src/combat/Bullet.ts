import type { ProjectileType } from './projectile';
import type { Circle, Rect, Triangle } from './Collision';
import { GOLD_FADE_TIME, SPAWN_FADE_TIME } from '../tuning';

/**
 * Shapes and their size fields (a, b):
 *  - circle:   a = radius
 *  - rect:     a = half width, b = half height (along rotation)
 *  - triangle: a = circumradius (equilateral, first vertex points along rotation)
 *  - beam:     a = length, b = thickness (a long rect centered on the position)
 *  - composite: `form` (combat/composite.ts) = several primitive parts in the bullet's frame; a, b unused
 * Drawing AND collision both derive from these via the shape functions below,
 * so what you see is exactly what hits you.
 */
export type BulletShape = 'circle' | 'rect' | 'triangle' | 'beam' | 'composite';
import type { CompositeForm } from './composite';
import type { Wall } from '../core/Box';
export type { Wall };
/** What a bullet does after its center crosses a box wall from inside. */
export type WallResponse = 'pass' | 'bounce' | 'die';

/** Context passed to hooks so they can spawn (e.g. split) without importing the pool. */
export interface BulletContext {
  spawn(spec: BulletSpec): Bullet | null;
}

export type StepHook = (b: Bullet, dt: number, ctx: BulletContext) => void;
/**
 * `box` is set when the wall belongs to another box than the bullet's frame (the box is split);
 * for the soul's box it is undefined (the bullet's own frame).
 */
export type WallHook = (b: Bullet, wall: Wall, ctx: BulletContext, box?: import('../core/Box').Box) => WallResponse;
/** Called once, on the step a pre-active bullet becomes active (its age reaches armAt). */
export type ArmHook = (b: Bullet, ctx: BulletContext) => void;

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
  /** Projectile type (default white). Decides the hit rule and the color. */
  kind?: ProjectileType;
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
  /**
   * Pre-active state: for this many seconds after spawning the bullet is drawn in the pre-active
   * color (theme.preActive, gold) and NEVER collides, then it becomes active (its type's color and
   * hit rule) with a shine. 0 (default) = active from the start.
   */
  armDelay?: number;
  /** While pre-active, draw it growing from nothing to full size over armDelay (visual only; it can't collide yet). */
  growIn?: boolean;
  onArm?: ArmHook;
  /** Parts for shape 'composite' (drawn and collided from the same definition). */
  form?: CompositeForm;
  /** Draw a faint decorative glow around it (light rays). Never part of the hitbox. */
  glow?: boolean;
  /**
   * A drawn OBJECT, not a projectile (The Warden's fists): never collides, never outlined by the
   * hitbox overlay, not an attack for the HUD-band rule. Drawn in `tint` with an edge outline.
   */
  decor?: boolean;
  /** Fill color for decor objects (projectiles always use their type color). */
  tint?: number;
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
  kind: ProjectileType = 'white';
  lifetime = Infinity;
  age = 0;
  owner = '';
  onStep: StepHook | undefined = undefined;
  onWall: WallHook | undefined = undefined;
  noPop = false;
  gen = 0;
  flags = 0;
  /** Age (s) at which the bullet becomes active; before that it is pre-active (drawn, never collides). */
  armAt = 0;
  /** Whether it is active (can collide). Set by the pool when age reaches armAt. */
  armed = true;
  growIn = false;
  onArm: ArmHook | undefined = undefined;
  form: CompositeForm | null = null;
  glow = false;
  decor = false;
  tint = 0;
  /** Pre-step position and rotation, for render interpolation only. Spawns start equal to the current state. */
  px = 0;
  py = 0;
  prot = 0;

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
    this.kind = s.kind ?? 'white';
    this.lifetime = s.lifetime ?? Infinity;
    this.age = 0;
    this.owner = s.owner ?? '';
    this.onStep = s.onStep;
    this.onWall = s.onWall;
    this.noPop = s.noPop ?? false;
    this.gen = s.gen ?? 0;
    this.flags = s.flags ?? 0;
    this.armAt = Math.max(0, s.armDelay ?? 0);
    this.armed = this.armAt <= 0;
    this.growIn = s.growIn ?? false;
    this.onArm = s.onArm;
    this.form = s.form ?? null;
    this.glow = s.glow ?? false;
    this.decor = s.decor ?? false;
    this.tint = s.tint ?? 0;
    this.snapshot();
    return this;
  }

  /** Record the pre-step state for render interpolation. */
  snapshot(): void {
    this.px = this.x;
    this.py = this.y;
    this.prot = this.rotation;
  }

  /**
   * Size factor shared by drawing and the hitbox. Always 1: bullets fade into existence at full
   * size (see `fadeAlpha`); there is no spawn pop or grow-in. Growing attacks (snowballs) change
   * their size fields instead.
   */
  get scale(): number {
    return 1;
  }

  /**
   * Visual-only fade-in (0..1): a new bullet fades in over SPAWN_FADE_TIME (skipped with noPop,
   * e.g. off-screen spawns); a `growIn` pre-active bullet fades in over its gold time (at most
   * GOLD_FADE_TIME). The hitbox is always full size; a pre-active bullet never collides anyway.
   */
  get fadeAlpha(): number {
    if (this.growIn && this.armAt > 0) return Math.min(1, this.age / Math.min(this.armAt, GOLD_FADE_TIME));
    if (this.noPop) return 1;
    return Math.min(1, this.age / SPAWN_FADE_TIME);
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

/** Seconds since the bullet became active (negative while pre-active). Drawing uses it for the shine. */
export function sinceArmed(b: Pick<Bullet, 'age' | 'armAt'>): number {
  return b.age - b.armAt;
}

/** Farthest point of a bullet's full-size shape from its center (for off-screen spawns). */
export function bulletExtent(spec: Pick<BulletSpec, 'shape' | 'a' | 'b'> & { form?: CompositeForm | null }): number {
  if (spec.shape === 'composite') return spec.form?.extent ?? 0;
  const b = spec.b ?? spec.a;
  if (spec.shape === 'beam') return Math.hypot(spec.a / 2, b / 2);
  if (spec.shape === 'rect') return Math.hypot(spec.a, b);
  return spec.a;
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
