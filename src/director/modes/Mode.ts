/** What a mode sees each step. Plain data so modes stay pure and testable. */
export interface BattleState {
  /** Simulated battle seconds. */
  time: number;
  soulAlive: boolean;
}

export type BattleResult = 'win' | 'loss';

/**
 * A battle mode only decides when the battle ends (and, for WaveMode, what loads next).
 * The Director owns time, characters and the world.
 */
export interface BattleMode {
  readonly id: string;
  readonly label: string;
  /** null while the battle continues. */
  evaluate(s: BattleState): BattleResult | null;
  /** Short HUD text for the mode's progress (e.g. countdown). */
  hud(s: BattleState): string;
}
