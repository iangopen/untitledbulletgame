import type { Box, Vec2 } from './Box';
import {
  IFRAME_DURATION,
  KR_DRAIN_RATE,
  MAX_HP,
  SLOW_MULTIPLIER,
  SOUL_RADIUS,
  SOUL_SPEED,
} from '../tuning';

export type DamageType = 'normal' | 'kr';

export interface DamageInfo {
  amount: number;
  type: DamageType;
}

/** Directional intent for one step: dx/dy in {-1, 0, 1}. */
export interface MoveInput {
  dx: number;
  dy: number;
  slow: boolean;
  /** The active-ability key (Shift) was pressed; true for one step per press. */
  ability?: boolean;
}

export type DamageResult = 'applied' | 'blocked' | 'dead';

/**
 * The player. Pure logic, no Phaser: position is box-local.
 * `damage()` is the single entry point for all damage in the game.
 *
 * KR rules:
 *  - A KR hit does not reduce HP immediately; it adds `amount` to the KR pool.
 *  - The pool drains into HP at KR_DRAIN_RATE HP/s, including during i-frames.
 *  - KR alone cannot kill: the pool never takes HP below 1.
 *  - KR hits respect and grant i-frames, same as normal hits.
 */
export class Soul {
  /** Box-local position. The soul stays where it is in the WORLD when its box moves, turns or scales (World.step); only walls that reach it push it. */
  readonly pos: Vec2 = { x: 0, y: 0 };
  /** Position at the start of the current step. Drawing only (render interpolation); logic never reads it. */
  readonly prev: Vec2 = { x: 0, y: 0 };
  private readonly dir: Vec2 = { x: 0, y: 0 };
  /** Drawn radius == collision radius. Never changes (a tossed box does not resize the soul). */
  readonly hitRadius = SOUL_RADIUS;
  hp = MAX_HP;
  readonly maxHp = MAX_HP;
  /** HP still owed to KR poison. */
  kr = 0;
  /** Seconds of invulnerability remaining. */
  iframes = 0;
  /**
   * Whether the soul counts as moving in the current step: a direction is held (set by move(),
   * even when pressing into a wall), or a dash is running (set by the ability). Being carried by
   * the box doesn't count. Blue/orange projectiles read this (combat/projectile.ts).
   */
  moving = false;

  get alive(): boolean {
    return this.hp > 0;
  }

  get invulnerable(): boolean {
    return this.iframes > 0;
  }

  /**
   * Controls are screen-relative (DEFAULT, Ian may change): input is rotated into box-local space,
   * so "up" always moves up on screen even when the box is rotated.
   */
  move(input: MoveInput, dt: number, box: Box): void {
    this.moving = false;
    if (!this.alive) return;
    let { dx, dy } = input;
    // Holding a direction counts as moving, so blue can't be ignored by hugging a wall.
    this.moving = dx !== 0 || dy !== 0;
    if (dx !== 0 && dy !== 0) {
      // Diagonals move at the same speed as straight lines.
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    const d = box.dirToLocal({ x: dx, y: dy }, this.dir);
    const speed = SOUL_SPEED * (input.slow ? SLOW_MULTIPLIER : 1);
    this.pos.x += d.x * speed * dt;
    this.pos.y += d.y * speed * dt;
    box.clampLocal(this.pos, this.hitRadius);
  }

  /** Advance timers and KR drain by one fixed step. */
  tick(dt: number): void {
    if (this.iframes > 0) this.iframes = Math.max(0, this.iframes - dt);
    if (this.kr > 0 && this.alive) {
      const drain = Math.min(this.kr, KR_DRAIN_RATE * dt, Math.max(0, this.hp - 1));
      this.hp -= drain;
      this.kr -= drain;
      // Pool can't be owed below the 1 HP floor.
      if (this.hp <= 1) this.kr = 0;
      if (this.kr < 1e-9) this.kr = 0;
    }
  }

  damage({ amount, type }: DamageInfo): DamageResult {
    if (!this.alive) return 'dead';
    if (amount <= 0 || this.invulnerable) return 'blocked';
    if (type === 'kr') {
      this.kr = Math.min(this.kr + amount, Math.max(0, this.hp - 1));
    } else {
      this.hp = Math.max(0, this.hp - amount);
      this.kr = Math.min(this.kr, Math.max(0, this.hp - 1));
    }
    this.iframes = IFRAME_DURATION;
    return this.alive ? 'applied' : 'dead';
  }

  /** Record the pre-step state for render interpolation. */
  snapshot(): void {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
  }

  reset(): void {
    this.pos.x = 0;
    this.pos.y = 0;
    this.snapshot();
    this.hp = this.maxHp;
    this.kr = 0;
    this.iframes = 0;
    this.moving = false;
  }
}
