import type { Box } from '../core/Box';
import { BULLET_CAPACITY, FAR_CULL_DISTANCE, SCREEN_HEIGHT, SCREEN_WIDTH } from '../tuning';
import type { Vec2 } from '../core/Box';
import { Bullet, bulletExtent, type BulletContext, type BulletSpec, type Wall } from './Bullet';

/** 'cancel' = removed before it was ever meant to be seen (no despawn fade). */
export type DespawnReason = 'lifetime' | 'offbox' | 'wall' | 'cleared' | 'cancel';

/**
 * Fixed-capacity bullet storage. All Bullet objects are allocated up front;
 * acquire/release never allocate. Acquiring past capacity returns null and
 * warns once (dev builds).
 */
export class BulletPool implements BulletContext {
  readonly capacity: number;
  readonly all: Bullet[];
  private readonly free: number[];
  private readonly index = new Map<Bullet, number>();
  private warned = false;
  /** Dropped spawns since creation (capacity overflow). */
  dropped = 0;
  /** Called on every despawn (renderer uses it for fade ghosts). */
  onDespawn: ((b: Bullet, reason: DespawnReason) => void) | undefined;

  constructor(capacity = BULLET_CAPACITY) {
    this.capacity = capacity;
    this.all = Array.from({ length: capacity }, () => new Bullet());
    this.all.forEach((b, i) => this.index.set(b, i));
    // Stack of free indices; pop from the end.
    this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }

  get activeCount(): number {
    return this.capacity - this.free.length;
  }

  acquire(): Bullet | null {
    const i = this.free.pop();
    if (i === undefined) {
      this.dropped++;
      if (!this.warned && import.meta.env?.DEV) {
        this.warned = true;
        console.warn(`[BulletPool] capacity ${this.capacity} reached; spawns are being dropped`);
      }
      return null;
    }
    return this.all[i]!;
  }

  /** Acquire and initialise from a spec. */
  spawn(spec: BulletSpec): Bullet | null {
    const b = this.acquire();
    return b ? b.init(spec) : null;
  }

  private readonly wp: Vec2 = { x: 0, y: 0 };

  /** Whether the bullet's whole current shape (center + extent, any rotation) is outside the screen. */
  offScreen(b: Bullet, box: Box): boolean {
    const p = box.toWorld(b, this.wp);
    const e = bulletExtent(b) * b.scale;
    return p.x + e < 0 || p.x - e > SCREEN_WIDTH || p.y + e < 0 || p.y - e > SCREEN_HEIGHT;
  }

  private readonly ol: Vec2 = { x: 0, y: 0 };
  /** A bullet's position (stored in `box`'s frame) in box `o`'s frame. */
  private otherLocal(box: Box, o: Box, b: Bullet): Vec2 {
    this.ol.x = b.x;
    this.ol.y = b.y;
    return o.toLocal(box.toWorld(this.ol, this.ol), this.ol);
  }
  private insideOther(box: Box, o: Box, b: Bullet): boolean {
    const l = this.otherLocal(box, o, b);
    return Math.abs(l.x) <= o.halfWidth && Math.abs(l.y) <= o.halfHeight;
  }
  /** Reflect a bullet off a wall of box `o` (in o's frame), then store it back in `box`'s frame. */
  private bounceIn(box: Box, o: Box, b: Bullet, wall: Wall): void {
    const d = o.rotation - box.rotation;
    const c = Math.cos(d), s = Math.sin(d);
    // Velocity into o's frame.
    let vx = b.vx * c + b.vy * s;
    let vy = -b.vx * s + b.vy * c;
    const l = this.otherLocal(box, o, b);
    if (wall === 'left' || wall === 'right') {
      vx = -vx;
      l.x = Math.sign(l.x) * (2 * o.halfWidth - Math.abs(l.x));
    } else {
      vy = -vy;
      l.y = Math.sign(l.y) * (2 * o.halfHeight - Math.abs(l.y));
    }
    b.vx = vx * c - vy * s;
    b.vy = vx * s + vy * c;
    const w = o.toWorld(l, l);
    const back = box.toLocal(w, w);
    b.x = back.x;
    b.y = back.y;
    if (b.faceVelocity) b.rotation = Math.atan2(b.vy, b.vx);
  }

  release(b: Bullet, reason: DespawnReason = 'cleared'): void {
    if (!b.active) return;
    b.active = false;
    b.onStep = undefined;
    b.onWall = undefined;
    b.onArm = undefined;
    this.free.push(this.index.get(b)!);
    this.onDespawn?.(b, reason);
  }

  clear(): void {
    for (const b of this.all) if (b.active) this.release(b, 'cleared');
  }

  /**
   * Advance every active bullet one fixed step in box-local space:
   * hook, motion, spin, lifetime, wall crossings, off-box despawn.
   */
  update(dt: number, box: Box, others: readonly Box[] = []): void {
    const hw = box.halfWidth;
    const hh = box.halfHeight;
    for (const b of this.all) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.lifetime) {
        this.release(b, 'lifetime');
        continue;
      }
      b.onStep?.(b, dt, this);
      if (!b.active) continue; // hook may release
      // Pre-active -> active: from this step on it collides (and its onArm hook runs once).
      if (!b.armed && b.age >= b.armAt - 1e-9) {
        b.armed = true;
        b.onArm?.(b, this);
        if (!b.active) continue;
      }
      const wasInside = Math.abs(b.x) <= hw && Math.abs(b.y) <= hh;
      // Inside-ness in every other box (split), measured in that box's own frame.
      let insideMask = 0;
      for (let k = 0; k < others.length; k++) if (this.insideOther(box, others[k]!, b)) insideMask |= 1 << k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.faceVelocity && (b.vx !== 0 || b.vy !== 0)) b.rotation = Math.atan2(b.vy, b.vx);
      else b.rotation += b.spin * dt;

      const inside = Math.abs(b.x) <= hw && Math.abs(b.y) <= hh;
      if (wasInside && !inside) {
        const wall: Wall =
          b.x > hw ? 'right' : b.x < -hw ? 'left' : b.y > hh ? 'bottom' : 'top';
        const res = b.onWall ? b.onWall(b, wall, this) : 'pass';
        if (res === 'die') {
          this.release(b, 'wall');
          continue;
        }
        if (res === 'bounce') {
          if (wall === 'left' || wall === 'right') {
            b.vx = -b.vx;
            b.x = Math.sign(b.x) * (2 * hw - Math.abs(b.x));
          } else {
            b.vy = -b.vy;
            b.y = Math.sign(b.y) * (2 * hh - Math.abs(b.y));
          }
          if (b.faceVelocity) b.rotation = Math.atan2(b.vy, b.vx);
          continue;
        }
      }
      // Wall hooks for the other boxes: a crossing from inside one of them to outside it fires the
      // hook with that box's wall (and the box). 'bounce' reflects in that box's frame.
      for (let k = 0; k < others.length && b.active; k++) {
        if (!(insideMask & (1 << k)) || this.insideOther(box, others[k]!, b)) continue;
        const o = others[k]!;
        const l = this.otherLocal(box, o, b);
        const ohw = o.halfWidth, ohh = o.halfHeight;
        const wall: Wall = l.x > ohw ? 'right' : l.x < -ohw ? 'left' : l.y > ohh ? 'bottom' : 'top';
        const res = b.onWall ? b.onWall(b, wall, this, o) : 'pass';
        if (res === 'die') this.release(b, 'wall');
        else if (res === 'bounce') this.bounceIn(box, o, b, wall);
      }
      if (!b.active) continue;
      // Cull only once the WHOLE shape has left the screen and the bullet is not heading toward
      // the box, so attacks spawned off screen travel in untouched and big bullets never vanish
      // while partly visible. Pre-active bullets wait for their lifetime or to become active.
      // Entering the box never fires wall hooks (only inside -> outside above does).
      if (b.x * b.x + b.y * b.y > FAR_CULL_DISTANCE * FAR_CULL_DISTANCE) {
        this.release(b, 'offbox');
      } else if (b.armed && b.x * b.vx + b.y * b.vy >= 0 && this.offScreen(b, box)) {
        this.release(b, 'offbox');
      }
    }
  }
}
