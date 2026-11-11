import type { EventBus } from './EventBus';
import type { DamageType } from './Soul';
import { BOX_MIN_HEIGHT, BOX_MIN_WIDTH } from '../tuning';

export interface Vec2 {
  x: number;
  y: number;
}

export type Wall = 'left' | 'right' | 'top' | 'bottom';
export const WALLS: readonly Wall[] = ['left', 'right', 'top', 'bottom'];

export interface WallState {
  damaging: boolean;
  damage: number;
  type: DamageType;
}

export type Easing = 'linear' | 'quadIn' | 'quadOut' | 'quadInOut' | 'cubicOut' | 'sineInOut';

/** Monotonic easings only (no overshoot), so a tween never passes its clamped target. */
export const EASINGS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicOut: (t) => 1 - (1 - t) ** 3,
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/** Which point stays fixed while resizing: the center, or the wall opposite the one that moves. */
export type Anchor = 'center' | Wall;

interface Track {
  from: number[];
  to: number[];
  elapsed: number;
  duration: number;
  ease: (t: number) => number;
  /** Last applied eased progress (position track applies deltas so it composes with anchored resizes). */
  last: number;
  anchor?: Anchor;
}

export interface BoxState {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * The arena. Its center is the origin of box-local space; x right, y down, rotated by `rotation`.
 *
 * Dynamic operations (resizeTo, moveTo, rotateTo, squeezeWall) are advanced by `step(dt)` on the
 * fixed step, never by Phaser tweens, so they are frame-rate independent and freeze on pause.
 *
 * Arbitration: size, position and rotation are three independent tracks that run at the same time.
 * A new request on a track replaces the running one, starting from the track's current value.
 */
export class Box {
  readonly defaults: BoxState;
  readonly walls: Record<Wall, WallState>;
  /** Optional bus for boxResized / boxMoved / boxRotated / wallStateChanged. */
  bus: EventBus | undefined;

  private size: Track | null = null;
  private pos: Track | null = null;
  private rot: Track | null = null;
  /**
   * Local-space shift (this step) that contents must apply to stay world-fixed when an anchored
   * resize moves the center. World applies it to the soul and bullets.
   */
  readonly contentShift: Vec2 = { x: 0, y: 0 };
  /** Geometry at the start of the current step, for render interpolation only. */
  readonly prev: BoxState;

  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
    public rotation = 0,
  ) {
    this.defaults = { x, y, width, height, rotation };
    this.walls = { left: safeWall(), right: safeWall(), top: safeWall(), bottom: safeWall() };
    this.prev = { x, y, width, height, rotation };
  }

  /** Record the pre-step geometry for render interpolation. */
  snapshot(): void {
    const p = this.prev;
    p.x = this.x;
    p.y = this.y;
    p.width = this.width;
    p.height = this.height;
    p.rotation = this.rotation;
  }

  get halfWidth(): number {
    return this.width / 2;
  }
  get halfHeight(): number {
    return this.height / 2;
  }
  get moving(): boolean {
    return !!(this.size || this.pos || this.rot);
  }

  toWorld(local: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const lx = local.x;
    const ly = local.y;
    out.x = this.x + lx * c - ly * s;
    out.y = this.y + lx * s + ly * c;
    return out;
  }

  toLocal(world: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const dx = world.x - this.x;
    const dy = world.y - this.y;
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
    return out;
  }

  /** Rotate a direction from screen space into box-local space (no translation). */
  dirToLocal(v: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const x = v.x * c + v.y * s;
    out.y = -v.x * s + v.y * c;
    out.x = x;
    return out;
  }

  /** Clamp a box-local point so a circle of `radius` stays inside the interior. */
  clampLocal(p: Vec2, radius = 0): Vec2 {
    const hw = Math.max(0, this.halfWidth - radius);
    const hh = Math.max(0, this.halfHeight - radius);
    p.x = Math.min(hw, Math.max(-hw, p.x));
    p.y = Math.min(hh, Math.max(-hh, p.y));
    return p;
  }

  /** Distance from a box-local point to a wall's inner line (negative = outside that wall). */
  distanceToWall(p: Vec2, wall: Wall): number {
    switch (wall) {
      case 'left': return p.x + this.halfWidth;
      case 'right': return this.halfWidth - p.x;
      case 'top': return p.y + this.halfHeight;
      case 'bottom': return this.halfHeight - p.y;
    }
  }

  // --- Requests ---------------------------------------------------------------

  /** Resize to (w, h), clamped to the minimum box size. `anchor` keeps that wall fixed in the world. */
  resizeTo(width: number, height: number, duration = 0, ease: Easing = 'quadOut', anchor: Anchor = 'center'): void {
    const w = Math.max(BOX_MIN_WIDTH, width);
    const h = Math.max(BOX_MIN_HEIGHT, height);
    this.size = track([this.width, this.height], [w, h], duration, ease, anchor);
    this.bus?.emit('boxResized', { width: w, height: h, duration, anchor });
    if (duration <= 0) this.stepSize(0);
  }

  /** Move one wall inward by `amount` px (negative = outward); the opposite wall stays put. */
  squeezeWall(wall: Wall, amount: number, duration = 0, ease: Easing = 'quadOut'): void {
    const horizontal = wall === 'left' || wall === 'right';
    const opposite: Wall = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[wall] as Wall;
    const target = this.size ? this.size.to : [this.width, this.height];
    const w = horizontal ? target[0]! - amount : target[0]!;
    const h = horizontal ? target[1]! : target[1]! - amount;
    this.resizeTo(w, h, duration, ease, opposite);
  }

  moveTo(x: number, y: number, duration = 0, ease: Easing = 'quadOut'): void {
    this.pos = track([this.x, this.y], [x, y], duration, ease);
    this.bus?.emit('boxMoved', { x, y, duration });
    if (duration <= 0) this.stepPos(0);
  }

  /** Rotate to an absolute angle (radians). */
  rotateTo(rotation: number, duration = 0, ease: Easing = 'quadInOut'): void {
    this.rot = track([this.rotation], [rotation], duration, ease);
    this.bus?.emit('boxRotated', { rotation, duration });
    if (duration <= 0) this.stepRot(0);
  }

  rotateBy(delta: number, duration = 0, ease: Easing = 'quadInOut'): void {
    this.rotateTo((this.rot ? this.rot.to[0]! : this.rotation) + delta, duration, ease);
  }

  setWall(wall: Wall, state: Partial<WallState>): void {
    Object.assign(this.walls[wall], state);
    const w = this.walls[wall];
    this.bus?.emit('wallStateChanged', { wall, damaging: w.damaging, damage: w.damage, type: w.type });
  }

  /** Back to the constructor state: geometry, safe walls, no running tracks. */
  reset(): void {
    Object.assign(this, { x: this.defaults.x, y: this.defaults.y, width: this.defaults.width, height: this.defaults.height, rotation: this.defaults.rotation });
    this.size = this.pos = this.rot = null;
    for (const w of WALLS) Object.assign(this.walls[w], safeWall());
    this.contentShift.x = this.contentShift.y = 0;
    this.snapshot();
  }

  get state(): BoxState {
    return { x: this.x, y: this.y, width: this.width, height: this.height, rotation: this.rotation };
  }

  // --- Fixed-step advance -------------------------------------------------------

  /** Advance all tracks by dt. Sets `contentShift` for this step. */
  step(dt: number): void {
    this.contentShift.x = 0;
    this.contentShift.y = 0;
    if (this.size) this.stepSize(dt);
    if (this.pos) this.stepPos(dt);
    if (this.rot) this.stepRot(dt);
  }

  private stepSize(dt: number): void {
    const t = this.size!;
    const k = advance(t, dt);
    const w = lerp(t.from[0]!, t.to[0]!, k);
    const h = lerp(t.from[1]!, t.to[1]!, k);
    const dw = w - this.width;
    const dh = h - this.height;
    this.width = w;
    this.height = h;
    // Anchored: the anchor wall stays fixed, so the center moves half the change toward the moving wall.
    let sx = 0;
    let sy = 0;
    if (t.anchor === 'left') sx = dw / 2;
    else if (t.anchor === 'right') sx = -dw / 2;
    else if (t.anchor === 'top') sy = dh / 2;
    else if (t.anchor === 'bottom') sy = -dh / 2;
    if (sx !== 0 || sy !== 0) {
      const c = Math.cos(this.rotation);
      const s = Math.sin(this.rotation);
      this.x += sx * c - sy * s;
      this.y += sx * s + sy * c;
      this.contentShift.x -= sx;
      this.contentShift.y -= sy;
    }
    if (k >= 1) this.size = null;
  }

  private stepPos(dt: number): void {
    const t = this.pos!;
    const prev = t.last;
    const k = advance(t, dt);
    // Apply as a delta so it composes with center motion from anchored resizes.
    this.x += (t.to[0]! - t.from[0]!) * (k - prev);
    this.y += (t.to[1]! - t.from[1]!) * (k - prev);
    if (k >= 1) this.pos = null;
  }

  private stepRot(dt: number): void {
    const t = this.rot!;
    const k = advance(t, dt);
    this.rotation = lerp(t.from[0]!, t.to[0]!, k);
    if (k >= 1) this.rot = null;
  }
}

function safeWall(): WallState {
  return { damaging: false, damage: 0, type: 'normal' };
}

function track(from: number[], to: number[], duration: number, ease: Easing, anchor?: Anchor): Track {
  return { from, to, elapsed: 0, duration: Math.max(0, duration), ease: EASINGS[ease], last: 0, anchor };
}

/** Advance a track and return its eased progress 0..1. */
function advance(t: Track, dt: number): number {
  t.elapsed += dt;
  const raw = t.duration <= 0 ? 1 : Math.min(1, t.elapsed / t.duration);
  t.last = raw >= 1 ? 1 : t.ease(raw);
  return t.last;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
