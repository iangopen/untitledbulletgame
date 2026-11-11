import type { MoveInput } from '../core/Soul';
import type { World } from '../core/World';

/** What an activation attempt did. Only 'used' spends the ability. */
export type ActivateResult = 'used' | 'notReady' | 'noop';

/**
 * An equipped active ability (one slot; the Phase 8 shop swaps it). Pure logic on the fixed step,
 * no Phaser. The HUD ability bar is built only from this interface, so every ability gets it.
 */
export interface ActiveAbility {
  readonly id: string;
  /** Short lowercase label for the HUD. */
  readonly name: string;
  /** Seconds from use until ready again. */
  readonly cooldown: number;
  /** Seconds until ready (0 = ready). */
  readonly remaining: number;
  readonly ready: boolean;
  /** Whether it is taking effect right now (e.g. mid-dash). */
  readonly active: boolean;
  /** Try to use it (Shift). Never spends anything unless it returns 'used'. */
  activate(world: World, input: MoveInput): ActivateResult;
  /**
   * Once per fixed step, before soul movement. Returns true when it moved the soul itself this
   * step (normal movement is skipped; the box clamp still applies after).
   */
  step(world: World, input: MoveInput, dt: number): boolean;
}

/** Shared cooldown bookkeeping for actives. */
export abstract class CooldownAbility implements ActiveAbility {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly cooldown: number;
  remaining = 0;

  get ready(): boolean {
    return this.remaining <= 0;
  }

  get active(): boolean {
    return false;
  }

  activate(world: World, input: MoveInput): ActivateResult {
    if (!this.ready) return 'notReady';
    if (!this.use(world, input)) return 'noop';
    this.remaining = this.cooldown;
    return 'used';
  }

  step(world: World, input: MoveInput, dt: number): boolean {
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dt);
    return this.update(world, input, dt);
  }

  /** Apply the ability. Return false if it can't apply now (nothing is spent). */
  protected abstract use(world: World, input: MoveInput): boolean;
  protected update(_world: World, _input: MoveInput, _dt: number): boolean {
    return false;
  }
}
