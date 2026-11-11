import { Box } from './Box';
import { Soul, type MoveInput } from './Soul';
import { BulletPool } from '../combat/BulletPool';
import { bulletHitsCircle } from '../combat/hitTest';
import type { Circle } from '../combat/Collision';
import { BOX_HEIGHT, BOX_WIDTH, WALL_CONTACT_EPS } from '../tuning';
import { WALLS } from './Box';
import { EventBus } from './EventBus';

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

  step(input: MoveInput, dt: number): void {
    const { soul, pool, box } = this;
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
    soul.move(input, dt, box);
    box.clampLocal(soul.pos, soul.hitRadius);
    soul.tick(dt);
    pool.update(dt, box);
    if (!soul.alive) return;

    const hit = this.hit;
    hit.x = soul.pos.x;
    hit.y = soul.pos.y;
    hit.r = soul.hitRadius;
    for (const b of pool.all) {
      if (!b.active || !bulletHitsCircle(b, hit)) continue;
      // All damage goes through Soul.damage; it decides i-frames and KR.
      if (soul.damage({ amount: b.damage, type: b.type }) !== 'blocked') this.lastHitStep = this.steps;
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
