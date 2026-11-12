import type { MoveInput } from '../../core/Soul';
import type { World } from '../../core/World';
import { SHIELD_COOLDOWN, SHIELD_DURATION } from '../../tuning';
import { CooldownAbility } from '../Ability';

/**
 * Shield: a bubble around the soul for SHIELD_DURATION. It absorbs exactly the next damaging hit
 * (any projectile type, a damaging wall; through Soul.damage, so harmless contacts such as gold
 * swords, fists or a blue bullet on a still soul never touch it), then breaks. Unused, it expires.
 */
export class Shield extends CooldownAbility {
  readonly id = 'shield';
  readonly name = 'shield';
  readonly baseCooldown = SHIELD_COOLDOWN;
  /** Seconds the bubble has left (0 = down). */
  left = 0;
  /** Seconds since the bubble last ended, and how ('broke' = absorbed a hit) (drawing). */
  endedAge = Infinity;
  ended: 'broke' | 'expired' | null = null;
  private breaksSeen = 0;

  override get active(): boolean {
    return this.left > 0;
  }

  protected use(world: World): boolean {
    world.soul.shielded = true;
    this.breaksSeen = world.soul.shieldBreaks;
    this.left = SHIELD_DURATION;
    this.ended = null;
    return true;
  }

  protected override update(world: World, _input: MoveInput, dt: number): boolean {
    this.endedAge += dt;
    if (this.left <= 0) return false;
    const soul = world.soul;
    if (soul.shieldBreaks !== this.breaksSeen) {
      this.end('broke');
      return false;
    }
    this.left = Math.max(0, this.left - dt);
    if (this.left <= 0) {
      soul.shielded = false;
      this.end('expired');
    }
    return false;
  }

  private end(how: 'broke' | 'expired'): void {
    this.left = 0;
    this.ended = how;
    this.endedAge = 0;
  }
}
