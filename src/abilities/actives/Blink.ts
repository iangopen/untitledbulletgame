import type { Vec2 } from '../../core/Box';
import type { MoveInput } from '../../core/Soul';
import type { World } from '../../core/World';
import { BLINK_COOLDOWN, BLINK_DISTANCE } from '../../tuning';
import { CooldownAbility } from '../Ability';

/**
 * Blink: an instant teleport BLINK_DISTANCE in the held direction (screen-relative), clamped inside
 * the soul's own box (never into another box while split; the toss only shrinks that box). Counts
 * as moving for blue/orange on the step it happens. No direction held = nothing happens, nothing spent.
 */
export class Blink extends CooldownAbility {
  readonly id = 'blink';
  readonly name = 'blink';
  readonly baseCooldown = BLINK_COOLDOWN;
  /** Box-local start and end of the last blink, and seconds since (drawing: flash). */
  readonly from: Vec2 = { x: 0, y: 0 };
  readonly to: Vec2 = { x: 0, y: 0 };
  age = Infinity;
  /** The blink happened this step (moving for the projectile rules; movement skipped). */
  private now = false;
  private readonly dir: Vec2 = { x: 0, y: 0 };

  protected use(world: World, input: MoveInput): boolean {
    if (input.dx === 0 && input.dy === 0) return false;
    const { soul, box } = world;
    const n = Math.hypot(input.dx, input.dy);
    box.dirToLocal({ x: input.dx / n, y: input.dy / n }, this.dir);
    this.from.x = soul.pos.x;
    this.from.y = soul.pos.y;
    soul.pos.x += this.dir.x * BLINK_DISTANCE;
    soul.pos.y += this.dir.y * BLINK_DISTANCE;
    box.clampLocal(soul.pos, soul.hitRadius);
    this.to.x = soul.pos.x;
    this.to.y = soul.pos.y;
    this.age = 0;
    this.now = true;
    return true;
  }

  protected override update(world: World, _input: MoveInput, dt: number): boolean {
    if (this.now) {
      this.now = false;
      world.soul.moving = true;
      return true; // the blink was this step's movement
    }
    this.age += dt;
    return false;
  }
}
