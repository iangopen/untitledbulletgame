import { Box, type BoxState } from './Box';
import { Soul, type MoveInput } from './Soul';
import { BulletPool } from '../combat/BulletPool';
import { bulletHitsCircle } from '../combat/hitTest';
import { damageTypeOf, projectileHurts } from '../combat/projectile';
import type { Circle, Triangle } from '../combat/Collision';
import { BOX_HEIGHT, BOX_MIN_WIDTH, BOX_WIDTH, WALL_CONTACT_EPS } from '../tuning';

const NO_BOXES: Box[] = [];
import { WALLS } from './Box';
import { EventBus } from './EventBus';
import type { ActiveAbility } from '../abilities/Ability';

/**
 * A non-damaging object inside the box (e.g. Prism's refraction prism).
 * Box-local, drawn translucent so it never reads as a hazard.
 */
export interface Prop {
  shape: 'triangle';
  x: number;
  y: number;
  /** Circumradius. */
  r: number;
  rotation: number;
  color: number;
  /** A refraction prop (Prism): projectiles passing through it may fan out. */
  refracts?: boolean;
}

/** A triangle prop's corners (box-local). */
export function propTriangle(p: Prop, out: Triangle): Triangle {
  const k = (2 * Math.PI) / 3;
  out.ax = p.x + Math.cos(p.rotation) * p.r;
  out.ay = p.y + Math.sin(p.rotation) * p.r;
  out.bx = p.x + Math.cos(p.rotation + k) * p.r;
  out.by = p.y + Math.sin(p.rotation + k) * p.r;
  out.cx = p.x + Math.cos(p.rotation + 2 * k) * p.r;
  out.cy = p.y + Math.sin(p.rotation + 2 * k) * p.r;
  return out;
}

/**
 * Pure battle simulation for one fixed step: soul, box, bullets, hits.
 * No Phaser. Scenes own a World, feed it input and draw it.
 */
export class World {
  /**
   * The SOUL'S box: the frame the soul and every bullet are stored in (box-local). Exactly one at
   * any time; the soul is clamped to it, pushed by it and touches only its walls. Characters aim
   * at it. Changes only through splitBox / mergeBoxes / resetBoxes, which re-express the soul and
   * every bullet in the new frame (their world positions never jump).
   */
  box: Box;
  /** Every box in play (one normally; two while The Warden has the box ripped apart). Includes `box`. */
  boxes: Box[];
  /** The battle's default box (center, size, rotation): where a single box returns to. */
  readonly home: BoxState;
  readonly soul = new Soul();
  readonly pool = new BulletPool();
  readonly bus = new EventBus();
  readonly props: Prop[] = [];
  /** The equipped active ability (from the loadout), or null. */
  ability: ActiveAbility | null = null;
  /** Simulated seconds. */
  time = 0;
  steps = 0;
  /** Step index of the most recent damaging hit (renderer triggers flash/shake on change). */
  lastHitStep = -1;
  private readonly hit: Circle = { x: 0, y: 0, r: 0 };

  constructor(centerX: number, centerY: number) {
    this.box = new Box(centerX, centerY, BOX_WIDTH, BOX_HEIGHT);
    this.box.bus = this.bus;
    this.boxes = [this.box];
    this.home = this.box.state;
  }

  /**
   * Record every moving object's state before a step, for render interpolation.
   * Drawing blends prev -> current; collision and logic only ever read the current state.
   */
  snapshot(): void {
    for (const b of this.boxes) b.snapshot();
    this.soul.snapshot();
    for (const b of this.pool.all) if (b.active) b.snapshot();
  }

  /**
   * Re-express every active bullet in the moved box's frame so it stays where it was in the world
   * (position, velocity and rotation), given the box's center and rotation before this step.
   */
  private keepBulletsWorldFixed(ox: number, oy: number, orot: number): void {
    const box = this.box;
    const c0 = Math.cos(orot), s0 = Math.sin(orot);
    const d = box.rotation - orot;
    const cd = Math.cos(d), sd = Math.sin(d);
    const c1 = Math.cos(box.rotation), s1 = Math.sin(box.rotation);
    for (const b of this.pool.all) {
      if (!b.active) continue;
      const wx = ox + b.x * c0 - b.y * s0 - box.x;
      const wy = oy + b.x * s0 + b.y * c0 - box.y;
      b.x = wx * c1 + wy * s1;
      b.y = -wx * s1 + wy * c1;
      if (d !== 0) {
        const vx = b.vx;
        b.vx = vx * cd + b.vy * sd;
        b.vy = -vx * sd + b.vy * cd;
        b.rotation -= d;
      }
    }
  }

  /** Boxes other than the soul's (empty unless split). */
  get otherBoxes(): Box[] {
    return this.boxes.length === 1 ? NO_BOXES : this.boxes.filter((b) => b !== this.box);
  }

  /**
   * Move the soul and every bullet (current and pre-step state) from `from`'s frame into `to`'s,
   * keeping their world positions, headings and velocities.
   */
  private reframe(from: Box, to: Box): void {
    const p = { x: 0, y: 0 };
    const map = (x: number, y: number): { x: number; y: number } => {
      p.x = x;
      p.y = y;
      return to.toLocal(from.toWorld(p, p), p);
    };
    const d = to.rotation - from.rotation;
    const cd = Math.cos(d), sd = Math.sin(d);
    const soul = this.soul;
    let q = map(soul.pos.x, soul.pos.y);
    soul.pos.x = q.x;
    soul.pos.y = q.y;
    q = map(soul.prev.x, soul.prev.y);
    soul.prev.x = q.x;
    soul.prev.y = q.y;
    for (const b of this.pool.all) {
      if (!b.active) continue;
      q = map(b.x, b.y);
      b.x = q.x;
      b.y = q.y;
      q = map(b.px, b.py);
      b.px = q.x;
      b.py = q.y;
      const vx = b.vx;
      b.vx = vx * cd + b.vy * sd;
      b.vy = -vx * sd + b.vy * cd;
      b.rotation -= d;
      b.prot -= d;
    }
  }

  private adopt(b: Box): Box {
    b.bus = this.bus;
    return b;
  }

  /**
   * Rip the soul's box into two halves side by side along its local x axis (left and right of its
   * center), each a real box with its own walls (copied), exactly covering the old one, so nothing
   * jumps. The soul's box becomes the half that contains the soul's center (x <= 0 -> left: a soul
   * exactly on the split line goes left and the clamp pushes it fully inside). Returns [left, right].
   * Does nothing (returns null) if already split or a half would be under the minimum size.
   */
  splitBox(): [Box, Box] | null {
    const old = this.box;
    if (this.boxes.length !== 1 || old.scale !== 1 || old.width / 2 < BOX_MIN_WIDTH) return null;
    const hw = old.width / 4;
    const c = Math.cos(old.rotation), s = Math.sin(old.rotation);
    const make = (sign: number) => {
      const b = this.adopt(new Box(old.x + sign * hw * c, old.y + sign * hw * s, old.width / 2, old.height, old.rotation));
      for (const w of WALLS) Object.assign(b.walls[w], old.walls[w]);
      return b;
    };
    const left = make(-1);
    const right = make(1);
    const soulBox = this.soul.pos.x <= 0 ? left : right;
    this.reframe(old, soulBox);
    soulBox.clampLocal(this.soul.pos, this.soul.hitRadius);
    this.boxes = [left, right];
    this.box = soulBox;
    this.bus.emit('boxSplit', { soulBox: soulBox === left ? 'left' : 'right', gapAxis: 'x', width: left.width, height: left.height });
    return [left, right];
  }

  /**
   * Join two boxes (side by side, same height and rotation) into one box covering both, measured in
   * `a`'s frame: the union of their outlines. The soul keeps its world position and is clamped into
   * the merged box. Called once the boxes touch, so the merged box draws exactly where the two were.
   */
  mergeBoxes(): Box | null {
    if (this.boxes.length !== 2) return null;
    const [a, b] = this.boxes as [Box, Box];
    const bl = a.toLocal(b);
    const x0 = Math.min(-a.halfWidth, bl.x - b.halfWidth);
    const x1 = Math.max(a.halfWidth, bl.x + b.halfWidth);
    const y0 = Math.min(-a.halfHeight, bl.y - b.halfHeight);
    const y1 = Math.max(a.halfHeight, bl.y + b.halfHeight);
    const center = a.toWorld({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
    const m = this.adopt(new Box(center.x, center.y, x1 - x0, y1 - y0, a.rotation));
    for (const w of WALLS) Object.assign(m.walls[w], this.box.walls[w]);
    this.reframe(this.box, m);
    m.clampLocal(this.soul.pos, this.soul.hitRadius);
    this.boxes = [m];
    this.box = m;
    this.bus.emit('boxMerged', { x: m.x, y: m.y, width: m.width, height: m.height });
    return m;
  }

  /** Back to one default box (home), keeping the soul's and bullets' world positions. */
  resetBoxes(): void {
    const h = this.home;
    const m = this.adopt(new Box(h.x, h.y, h.width, h.height, h.rotation));
    this.reframe(this.box, m);
    m.clampLocal(this.soul.pos, this.soul.hitRadius);
    this.boxes = [m];
    this.box = m;
  }

  step(input: MoveInput, dt: number): void {
    const { soul, pool, box } = this;
    this.snapshot();
    this.steps++;
    this.time += dt;
    // 1. Box motion. The soul and every bullet stay WORLD-fixed: wherever the box moves, turns,
    // resizes or scales (a toss), the box slides under them. The soul keeps its world position and
    // only a wall that actually reaches it moves it (the clamp below pushes it just inside). Bullets
    // keep their world position, heading and velocity, so a shoved or spun box runs into attacks
    // already in flight. Hooks that pin a bullet to the box (Ulysses' axe pivot, The Warden's fists)
    // re-pin it in pool.update below.
    const ox = box.x, oy = box.y, orot = box.rotation;
    const c0 = Math.cos(orot), s0 = Math.sin(orot);
    const swx = ox + soul.pos.x * c0 - soul.pos.y * s0;
    const swy = oy + soul.pos.x * s0 + soul.pos.y * c0;
    box.step(dt);
    if (box.x !== ox || box.y !== oy || box.rotation !== orot) {
      const c1 = Math.cos(box.rotation), s1 = Math.sin(box.rotation);
      const dx = swx - box.x, dy = swy - box.y;
      soul.pos.x = dx * c1 + dy * s1;
      soul.pos.y = -dx * s1 + dy * c1;
      this.keepBulletsWorldFixed(ox, oy, orot);
    }
    // Other boxes (split) move on their own tracks; bullets are not stored in their frames.
    const others = this.otherBoxes;
    for (const o of others) o.step(dt);
    // 2. Soul. Clamping every step means a moving wall pushes the soul inward; it can never be outside.
    // The active ability runs first; it may take over movement (dash).
    const ab = this.ability;
    if (ab && input.ability && soul.alive) {
      const remaining = ab.remaining;
      const r = ab.activate(this, input);
      if (r === 'used') this.bus.emit('abilityUsed', { id: ab.id });
      else if (r === 'notReady') this.bus.emit('abilityDenied', { id: ab.id, remaining });
    }
    const took = ab ? ab.step(this, input, dt) : false;
    if (!took) soul.move(input, dt, box);
    box.clampLocal(soul.pos, soul.hitRadius);
    soul.tick(dt);
    pool.update(dt, box, others);
    // Per-step hook for combo rules (director/interactions.ts), after bullets move, before hits.
    this.bus.emit('stepped', { dt });
    if (!soul.alive) return;

    const hit = this.hit;
    hit.x = soul.pos.x;
    hit.y = soul.pos.y;
    hit.r = soul.hitRadius;
    for (const b of pool.all) {
      // Pre-active (gold) bullets are drawn but never collide.
      // Decor objects (The Warden's fists) never collide.
      if (!b.active || !b.armed || b.decor || !bulletHitsCircle(b, hit)) continue;
      // Projectile type rules (blue/orange) are decided in one place, from this step's movement.
      if (!projectileHurts(b.kind, soul.moving)) continue;
      // All damage goes through Soul.damage; it decides i-frames and KR.
      if (soul.damage({ amount: b.damage, type: damageTypeOf(b.kind) }) !== 'blocked') this.lastHitStep = this.steps;
    }

    // 3. Damaging walls: contact = soul pressed against the wall. Damage goes through Soul.damage.
    for (const wall of WALLS) {
      const ws = box.walls[wall];
      if (!ws.damaging || box.distanceToWall(soul.pos, wall) > soul.hitRadius + WALL_CONTACT_EPS) continue;
      if (soul.damage({ amount: ws.damage, type: ws.type }) !== 'blocked') {
        this.lastHitStep = this.steps;
        this.bus.emit('wallHit', { wall, damage: ws.damage, type: ws.type });
      }
    }
  }
}
