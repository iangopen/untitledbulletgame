import { MAX_DIVISOR } from './settings';

/**
 * Display refresh rate and frame caps (pure).
 * A cap is always the refresh rate divided by a whole number, so drawing on every Nth display tick
 * paces evenly (72 on 144 Hz, 60 on 120 Hz, 30 on 60 Hz). Uneven caps like 60 on 144 Hz judder.
 */
export const MIN_CAP_FPS = 30;
/** Estimates outside this range are throttling or noise, not a display. */
export const MIN_HZ = 30;
export const MAX_HZ = 500;

export interface CapOption {
  divisor: number;
  fps: number;
}

/** Refresh rate from display tick intervals (ms): the median, rounded to whole Hz; null if implausible. */
export function hzFromIntervals(intervals: readonly number[]): number | null {
  const v = intervals.filter((x) => x > 0 && Number.isFinite(x));
  if (v.length < 10) return null;
  const s = [...v].sort((a, b) => a - b);
  const hz = snapHz(1000 / s[Math.floor(s.length / 2)]!);
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : null;
}

/** Common display rates. An estimate within 2% snaps to one (timer jitter reads 144 as 145). */
export const COMMON_HZ = [48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 160, 165, 170, 175, 180, 200, 240, 280, 300, 360] as const;

export function snapHz(raw: number): number {
  for (const c of COMMON_HZ) if (Math.abs(raw - c) <= c * 0.02) return c;
  return Math.round(raw);
}

/** Match display, then every whole divisor that keeps at least MIN_CAP_FPS. */
export function capOptions(hz: number): CapOption[] {
  const out: CapOption[] = [{ divisor: 1, fps: hz }];
  for (let d = 2; d <= MAX_DIVISOR && hz / d >= MIN_CAP_FPS - 1e-9; d++) out.push({ divisor: d, fps: hz / d });
  return out;
}

/** The stored divisor, limited to what this display offers. */
export function effectiveDivisor(stored: number, hz: number): number {
  const opts = capOptions(hz);
  return Math.min(Math.max(1, Math.floor(stored)), opts[opts.length - 1]!.divisor);
}

/** "72", "82.5", "41.25" */
export function formatFps(fps: number): string {
  return String(Math.round(fps * 100) / 100);
}

/**
 * Whether to draw on this display tick. Draws land on whole ticks: once the time since the last draw
 * reaches divisor - 0.5 ticks, so jitter never shifts a draw by a tick, and a missed tick draws on the next.
 */
export function shouldDraw(now: number, lastDraw: number, divisor: number, tickMs: number): boolean {
  if (divisor <= 1 || lastDraw <= 0) return true;
  return now - lastDraw >= (divisor - 0.5) * tickMs;
}

/** True when two estimates differ by more than `tol` (fraction). */
export function rateChanged(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) > tol * Math.max(a, b);
}
