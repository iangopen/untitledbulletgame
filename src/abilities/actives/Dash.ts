import type { Vec2 } from '../../core/Box';
import type { MoveInput } from '../../core/Soul';
import type { World } from '../../core/World';
import { DASH_COOLDOWN, DASH_DISTANCE, DASH_DURATION, DASH_IFRAMES } from '../../tuning';
import { CooldownAbility } from '../Ability';

/**
 * Dash: a fast, continuous move in the held direction (screen-relative, like normal movement),
 * DASH_DISTANCE over DASH_DURATION, with DASH_IFRAMES of i-frames. The box clamp and wall push
 * apply every step, so a dash into a wall stops at the wall. No direction held = nothing happens.
 */
export class Dash extends CooldownAbility {
  readonly id = 'dash';
  readonly name = 'dash';
  readonly cooldown = DASH_COOLDOWN;
  /** Box-local unit direction of the current dash. */
  private readonly dir: Vec2 = { x: 0, y: 0 };
  /** Seconds of dash movement left. */
  private left = 0;
  /** Seconds since the last dash started (drawing: trail fade). */
  age = Infinity;
  /** Box-local start of the last dash (drawing: trail). */
  readonly from: Vec2 = { x: 0, y: 0 };

  override get active(): boolean {
    return this.left > 0;
  }

  protected use(world: World, input: MoveInput): boolean {
    if (input.dx === 0 && input.dy === 0) return false;
    const n = Math.hypot(input.dx, input.dy);
    world.box.dirToLocal({ x: input.dx / n, y: input.dy / n }, this.dir);
    this.left = DASH_DURATION;
    this.age = 0;
    this.from.x = world.soul.pos.x;
    this.from.y = world.soul.pos.y;
    const soul = world.soul;
    soul.iframes = Math.max(soul.iframes, DASH_IFRAMES);
    return true;
  }

  protected override update(world: World, _input: MoveInput, dt: number): boolean {
    this.age += dt;
    if (this.left <= 0) return false;
    const t = Math.min(dt, this.left);
    this.left -= t;
    if (this.left < 1e-9) this.left = 0;
    const { soul, box } = world;
    const speed = (DASH_DISTANCE / DASH_DURATION) * soul.scale;
    soul.pos.x += this.dir.x * speed * t;
    soul.pos.y += this.dir.y * speed * t;
    box.clampLocal(soul.pos, soul.hitRadius);
    soul.moving = true;
    return true;
  }
}
