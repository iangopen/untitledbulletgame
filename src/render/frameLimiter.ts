import type Phaser from 'phaser';
import { effectiveDivisor, hzFromIntervals, rateChanged, shouldDraw } from '../settings/refresh';
import { settings } from '../settings/store';

/**
 * Display refresh measurement and the frame-rate limit.
 *
 * Refresh: display tick intervals (every requestAnimationFrame tick, drawn or not) go into a rolling
 * sample. The first estimate comes after a short startup sample; afterwards the rate is re-checked
 * every window and updated when it clearly changes (two windows in a row), or re-sampled from
 * scratch when the pixel ratio changes (moving to another screen). Throttled or implausible samples
 * (under 30 Hz) are ignored.
 *
 * Limit: Phaser's whole tick (input, scene update, render) is skipped on display ticks that don't
 * draw; the skipped time is handed to the next drawn tick so Phaser timers and tweens keep real
 * time. The simulation is untouched: FixedLoop runs fixed steps from performance.now(), so it still
 * does 60 steps per second under any cap, and interpolation blends by the leftover fraction.
 */
const STARTUP_TICKS = 30;
const WINDOW_TICKS = 120;
const DEFAULT_HZ = 60;

class FrameLimiter {
  /** Measured display refresh rate (Hz); DEFAULT_HZ until measured. */
  hz = DEFAULT_HZ;
  measured = false;
  private intervals: number[] = [];
  private lastTick = 0;
  private lastDraw = 0;
  private pendingDelta = 0;
  private pendingChange: number | null = null;
  private readonly listeners: (() => void)[] = [];
  /** Tick timestamps (rAF time) of the last few draws, for verification. */
  readonly drawTimes: number[] = [];

  get divisor(): number {
    return effectiveDivisor(settings.current.frameDivisor, this.hz);
  }

  onRateChange(l: () => void): void {
    this.listeners.push(l);
  }

  install(game: Phaser.Game): void {
    // Phaser emits 'ready' before it starts the loop, and loop.start() replaces the callback,
    // so intercept start() itself (or wrap the live callback if the loop is already running).
    const loop = game.loop;
    if (loop.running) {
      const inner = loop.callback;
      loop.callback = (time: number, delta: number) => this.tick(inner, time, delta);
    } else {
      const start = loop.start.bind(loop);
      loop.start = (cb) => start((time: number, delta: number) => this.tick(cb, time, delta));
    }

    const watchRatio = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', () => {
        this.resample();
        watchRatio();
      }, { once: true });
    };
    watchRatio();
    (window as unknown as Record<string, unknown>).__limiter = this;
  }

  /** Forget the sample and measure again from scratch. */
  resample(): void {
    this.intervals = [];
    this.measured = false;
    this.pendingChange = null;
  }

  private tick(inner: (time: number, delta: number) => void, time: number, delta: number): void {
    // The rAF timestamp is the frame's vsync-aligned time; unlike performance.now() it doesn't carry
    // how late the callback ran, so draws land on whole ticks even when the main thread is busy.
    const now = time > 0 ? time : performance.now();
    if (this.lastTick > 0) this.sample(now - this.lastTick);
    this.lastTick = now;

    this.pendingDelta += delta;
    if (!shouldDraw(now, this.lastDraw, this.divisor, 1000 / this.hz)) return;
    this.lastDraw = now;
    this.drawTimes.push(now);
    if (this.drawTimes.length > 600) this.drawTimes.shift();
    const d = this.pendingDelta;
    this.pendingDelta = 0;
    inner(time, d);
  }

  private sample(ms: number): void {
    // A long gap (tab hidden, debugger, stall) says nothing about the display.
    if (ms > 200) return;
    this.intervals.push(ms);
    const need = this.measured ? WINDOW_TICKS : STARTUP_TICKS;
    if (this.intervals.length < need) return;
    const hz = hzFromIntervals(this.intervals);
    this.intervals = [];
    if (hz === null) return;
    if (!this.measured) {
      this.measured = true;
      this.setHz(hz);
      return;
    }
    if (!rateChanged(hz, this.hz)) {
      this.pendingChange = null;
      return;
    }
    // Clearly different twice in a row: the display (or its mode) changed.
    if (this.pendingChange !== null && !rateChanged(hz, this.pendingChange)) {
      this.pendingChange = null;
      this.setHz(hz);
    } else {
      this.pendingChange = hz;
    }
  }

  private setHz(hz: number): void {
    if (hz === this.hz) return;
    this.hz = hz;
    for (const l of this.listeners) l();
  }
}

export const frameLimiter = new FrameLimiter();
