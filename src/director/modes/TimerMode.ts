import { TIMER_DURATION } from '../../tuning';
import type { BattleMode, BattleResult, BattleState } from './Mode';

/** Survive until `duration` seconds to win; HP reaching 0 loses (death wins ties). */
export class TimerMode implements BattleMode {
  readonly id = 'timer';
  readonly label = 'Timer';

  constructor(readonly duration: number = TIMER_DURATION) {}

  evaluate(s: BattleState): BattleResult | null {
    if (!s.soulAlive) return 'loss';
    if (s.time >= this.duration - 1e-9) return 'win';
    return null;
  }

  remaining(time: number): number {
    return Math.max(0, this.duration - time);
  }

  hud(s: BattleState): string {
    return formatClock(this.remaining(s.time));
  }
}

/** m:ss, rounding up so the clock reads 0:00 only when time is actually up. */
export function formatClock(seconds: number): string {
  const s = Math.ceil(seconds - 1e-9);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
