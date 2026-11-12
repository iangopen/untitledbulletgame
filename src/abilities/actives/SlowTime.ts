import type { MoveInput } from '../../core/Soul';
import type { World } from '../../core/World';
import { SLOWTIME_COOLDOWN, SLOWTIME_DURATION, SLOWTIME_SCALE } from '../../tuning';
import { CooldownAbility } from '../Ability';

/**
 * Slow time: for SLOWTIME_DURATION real seconds the world runs at SLOWTIME_SCALE (World.timeScale:
 * bullets, boxes, character attack timers, hazards), while the soul moves at normal speed. The
 * fixed step never changes, so it stays deterministic; the battle timer counts real time.
 */
export class SlowTime extends CooldownAbility {
  readonly id = 'slow';
  readonly name = 'slow time';
  readonly baseCooldown = SLOWTIME_COOLDOWN;
  /** Real seconds of slow left. */
  left = 0;

  override get active(): boolean {
    return this.left > 0;
  }

  protected use(world: World): boolean {
    this.left = SLOWTIME_DURATION;
    world.timeScale = SLOWTIME_SCALE;
    return true;
  }

  protected override update(world: World, _input: MoveInput, dt: number): boolean {
    if (this.left <= 0) return false;
    this.left = Math.max(0, this.left - dt);
    if (this.left <= 1e-9) {
      this.left = 0;
      world.timeScale = 1;
    }
    return false;
  }
}
