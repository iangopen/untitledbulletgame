import { Box } from './Box';
import { Soul, type MoveInput } from './Soul';
import { BulletPool } from '../combat/BulletPool';
import { bulletHitsCircle } from '../combat/hitTest';
import { damageTypeOf, projectileHurts } from '../combat/projectile';
import type { Circle, Triangle } from '../combat/Collision';
import { BOX_HEIGHT, BOX_WIDTH, WALL_CONTACT_EPS } from '../tuning';
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
  readonly box: Box;
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
  }

  /**
   * Record every moving object's state before a step, for render interpolation.
   * Drawing blends prev -> current; collision and logic only ever read the current state.
   */
  snapshot(): void {
    this.box.snapshot();
    this.soul.snapshot();
    for (const b of this.pool.all) if (b.active) b.snapshot();
  }

  step(input: MoveInput, dt: number): void {
    const { soul, pool, box } = this;
    this.snapshot();
    this.steps++;
    this.time += dt;
    // 1. Box motion. Anchored resizes report a content shift so contents stay world-fixed.
    box.step(dt);
    const sh = box.contentShift;
    if (sh.x !== 0 || sh.y !== 0) {
      soul.pos.x += sh.x;
      soul.pos.y += sh.y;
      for (const b of pool.all) {
        if (!b.active) continue;
        b.x += sh.x;
        b.y += sh.y;
      }
    }
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
    pool.update(dt, box);
    // Per-step hook for combo rules (director/interactions.ts), after bullets move, before hits.
    this.bus.emit('stepped', { dt });
    if (!soul.alive) return;

    const hit = this.hit;
    hit.x = soul.pos.x;
    hit.y = soul.pos.y;
    hit.r = soul.hitRadius;
    for (const b of pool.all) {
      // Pre-active (gold) bullets are drawn but never collide.
      if (!b.active || !b.armed || !bulletHitsCircle(b, hit)) continue;
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
