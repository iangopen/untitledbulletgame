import { Box } from './Box';
import { Soul, type MoveInput } from './Soul';
import { BulletPool } from '../combat/BulletPool';
import { bulletHitsCircle } from '../combat/hitTest';
import type { Circle } from '../combat/Collision';
import { BOX_HEIGHT, BOX_WIDTH } from '../tuning';
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
  }

  step(input: MoveInput, dt: number): void {
    const { soul, pool, box } = this;
    this.steps++;
    this.time += dt;
    soul.move(input, dt, box);
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
  }
}
