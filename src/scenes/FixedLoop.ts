import Phaser from 'phaser';
import { Clock, STEP } from '../core/Clock';
import type { MoveInput } from '../core/Soul';

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'shift';

/**
 * Reads movement keys and runs fixed 60 Hz steps from real elapsed time.
 * Uses performance.now(), not Phaser's delta: Phaser smooths and caps delta,
 * which silently slows the simulation when the frame rate drops.
 */
export class FixedLoop {
  readonly clock = new Clock();
  readonly input: MoveInput = { dx: 0, dy: 0, slow: false };
  private readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private last = 0;
  /** Seconds of real time covered by the last frame. */
  realDt = 0;
  /** Duration of the last simulation step, ms (perf readout). */
  lastStepMs = 0;
  /** Worst step duration since reset, ms. */
  maxStepMs = 0;

  constructor(scene: Phaser.Scene) {
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = scene.input.keyboard!.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, shift: K.SHIFT,
    }) as Record<KeyName, Phaser.Input.Keyboard.Key>;
  }

  /** Forget the last frame time (after a pause) so the clock does not try to catch up. */
  resync(): void {
    this.last = 0;
  }

  /** Call once per render frame. */
  frame(step: (input: MoveInput, dt: number) => void): void {
    const k = this.keys;
    this.input.dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    this.input.dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    this.input.slow = k.shift.isDown;

    const now = performance.now();
    this.realDt = this.last === 0 ? 0 : (now - this.last) / 1000;
    this.last = now;
    const n = this.clock.advance(this.realDt);
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      step(this.input, STEP);
      this.lastStepMs = performance.now() - t0;
      if (this.lastStepMs > this.maxStepMs) this.maxStepMs = this.lastStepMs;
    }
  }
}
