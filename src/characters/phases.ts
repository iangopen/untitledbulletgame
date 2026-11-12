/**
 * Alternating attack phases (pure). A character cycles through `order`, each phase `phaseLength`
 * seconds followed by a `breather` with no new arrivals. Each attack belongs to one phase and only
 * arrives inside that phase's window. Characters keep these numbers as data in their config rules.
 */
export interface PhaseTiming {
  phaseLength: number;
  breather: number;
}

export interface PhaseState<P extends string> {
  /** What runs now ('breather' = no new arrivals). */
  phase: P | 'breather';
  /** The current phase, or the one after the breather. */
  next: P;
}

/** The phase at time `t` (s since the battle started) for the given order. */
export function phaseAt<P extends string>(timing: PhaseTiming, order: readonly P[], t: number): PhaseState<P> {
  const slot = timing.phaseLength + timing.breather;
  const k = Math.floor(t / slot);
  const cur = order[k % order.length]!;
  return t - k * slot < timing.phaseLength ? { phase: cur, next: cur } : { phase: 'breather', next: order[(k + 1) % order.length]! };
}

/**
 * The earliest time >= `at` inside a window of phase `want` (or `at` if `want` is not in the order).
 * `tail` closes the window that much early, for attacks whose arrivals last a while (a gust's waves).
 */
export function nextPhaseArrival<P extends string>(timing: PhaseTiming, order: readonly P[], want: P, at: number, tail = 0): number {
  const slot = timing.phaseLength + timing.breather;
  let k = Math.floor(at / slot);
  for (let i = 0; i <= order.length; i++, k++) {
    if (order[k % order.length] !== want) continue;
    const start = k * slot;
    if (at < start) return start;
    if (at < start + Math.max(0, timing.phaseLength - tail)) return at;
  }
  return at;
}
