import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  type Settings,
} from './settings';
import { capOptions, effectiveDivisor, formatFps, hzFromIntervals, shouldDraw } from './refresh';

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('settings load/save', () => {
  const custom: Settings = { frameDivisor: 2, quality: 'balanced', showFps: true, shake: false, flash: false, charInfo: false };

  it('round-trips through its own versioned key', () => {
    const st = memStore();
    expect(saveSettings(st, custom)).toBe(true);
    expect([...st.m.keys()]).toEqual([SETTINGS_KEY]);
    expect(loadSettings(st)).toEqual(custom);
  });

  it('missing data gives defaults', () => {
    expect(loadSettings(memStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('corrupt, wrong-version or non-object data gives defaults', () => {
    for (const raw of ['{not json', '42', 'null', '[]', '"x"', JSON.stringify({ v: 99, ...custom }), JSON.stringify(custom)]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('invalid fields fall back one by one; unknown fields are ignored', () => {
    const raw = JSON.stringify({ v: 1, frameDivisor: 9, quality: 'ultra', showFps: 'yes', shake: false, flash: 0, extra: 1 });
    expect(parseSettings(raw)).toEqual({ ...DEFAULT_SETTINGS, shake: false });
    expect(parseSettings(JSON.stringify({ v: 1, frameDivisor: 1.5 })).frameDivisor).toBe(1);
  });

  it('throwing storage never throws out', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(bad, custom)).toBe(false);
  });

  it('serialises with a version field', () => {
    expect(JSON.parse(serializeSettings(custom)).v).toBe(1);
  });
});

describe('refresh rate and frame caps', () => {
  it('builds even caps for 60, 120, 144 and 165 Hz', () => {
    const fps = (hz: number) => capOptions(hz).map((o) => formatFps(o.fps));
    expect(fps(60)).toEqual(['60', '30']);
    expect(fps(120)).toEqual(['120', '60', '40', '30']);
    expect(fps(144)).toEqual(['144', '72', '48', '36']);
    expect(fps(165)).toEqual(['165', '82.5', '55', '41.25']);
  });

  it('limits a stored divisor to what the display offers', () => {
    expect(effectiveDivisor(4, 144)).toBe(4);
    expect(effectiveDivisor(4, 60)).toBe(2);
    expect(effectiveDivisor(3, 120)).toBe(3);
  });

  it('estimates the rate from tick intervals and rejects throttled samples', () => {
    expect(hzFromIntervals(Array.from({ length: 40 }, (_, i) => 1000 / 144 + (i % 3 - 1) * 0.3))).toBe(144);
    expect(hzFromIntervals(Array.from({ length: 40 }, () => 16.683))).toBe(60);
    expect(hzFromIntervals(Array.from({ length: 40 }, () => 75))).toBeNull(); // 13 Hz = throttled
    expect(hzFromIntervals([16, 16])).toBeNull(); // too few
    expect(hzFromIntervals(Array.from({ length: 40 }, () => 1000 / 145.2))).toBe(144); // jitter snaps
    expect(hzFromIntervals(Array.from({ length: 40 }, () => 1000 / 164.9))).toBe(165);
    expect(hzFromIntervals(Array.from({ length: 40 }, () => 1000 / 79))).toBe(79); // unusual rates kept
  });
});

/** Run display ticks through shouldDraw and return the intervals between draws, in ticks. */
function drawTicks(hz: number, divisor: number, ticks: number, jitterMs = 0, dropEvery = 0): number[] {
  const tick = 1000 / hz;
  let last = 0;
  const draws: number[] = [];
  let seed = 3;
  for (let i = 1; i <= ticks; i++) {
    if (dropEvery && i % dropEvery === 0) continue; // a missed vsync
    seed = (seed * 16807) % 2147483647;
    const now = i * tick + (jitterMs ? ((seed / 2147483647) * 2 - 1) * jitterMs : 0);
    if (shouldDraw(now, last, divisor, tick)) {
      last = now;
      draws.push(i);
    }
  }
  return draws.slice(1).map((t, k) => t - draws[k]!);
}

describe('frame-limit tick skipping', () => {
  for (const hz of [60, 120, 144, 165]) {
    for (const { divisor } of capOptions(hz)) {
      it(`${hz} Hz / ${divisor} draws every ${divisor} ticks, even with +-1 ms jitter`, () => {
        for (const gap of drawTicks(hz, divisor, 600, 1)) expect(gap).toBe(divisor);
      });
    }
  }

  it('a missed tick draws on the next one, then the cadence resumes', () => {
    const gaps = drawTicks(144, 2, 200, 0, 7);
    expect(gaps.every((g) => g === 2 || g === 3)).toBe(true);
    expect(gaps.filter((g) => g === 2).length).toBeGreaterThan(gaps.length * 0.6); // one drop per 7 ticks = one 3-gap per ~3.5 draws
  });
});
