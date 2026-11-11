/**
 * Fixed-timestep clock. Rendering frames feed real elapsed time in;
 * the clock tells you how many fixed simulation steps to run.
 * Game logic only ever sees STEP seconds, so speed is frame-rate independent.
 */
export const STEP_HZ = 60;
export const STEP = 1 / STEP_HZ;
/** Upper bound on real time consumed per frame, to avoid a spiral of death after a stall. */
export const MAX_FRAME = 0.25;

export class Clock {
  private accumulator = 0;
  /** Total simulated time in seconds. */
  time = 0;
  /** Total simulated steps. */
  steps = 0;
  paused = false;

  /** Feed real elapsed seconds; returns the number of fixed steps to run now. */
  advance(realSeconds: number): number {
    if (this.paused || !(realSeconds > 0)) return 0;
    this.accumulator += Math.min(realSeconds, MAX_FRAME);
    let n = 0;
    // Small epsilon so 1/60 accumulated in floating point doesn't drop a step.
    while (this.accumulator + 1e-9 >= STEP) {
      this.accumulator -= STEP;
      n++;
    }
    this.steps += n;
    this.time = this.steps * STEP;
    return n;
  }

  /** Fraction of a step left over (0..1), for optional render interpolation. */
  get alpha(): number {
    return Math.max(0, this.accumulator) / STEP;
  }
}
