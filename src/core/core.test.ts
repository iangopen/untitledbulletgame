import { describe, expect, it } from 'vitest';
import { Box } from './Box';
import { Clock, MAX_FRAME, STEP } from './Clock';
import { Soul } from './Soul';
import { SOUL_RADIUS, IFRAME_DURATION, KR_DRAIN_RATE, MAX_HP, SLOW_MULTIPLIER, SOUL_SPEED } from '../tuning';

describe('Clock', () => {
  it('runs 60 steps per simulated second regardless of frame size', () => {
    for (const fps of [30, 60, 144, 240]) {
      const c = new Clock();
      let steps = 0;
      for (let i = 0; i < fps; i++) steps += c.advance(1 / fps);
      expect(steps).toBe(60);
    }
  });
  it('carries remainder between frames', () => {
    const c = new Clock();
    expect(c.advance(STEP * 0.6)).toBe(0);
    expect(c.advance(STEP * 0.6)).toBe(1);
  });
  it('caps a long stall', () => {
    const c = new Clock();
    expect(c.advance(5)).toBe(Math.floor(MAX_FRAME / STEP + 1e-6));
  });
  it('does nothing when paused', () => {
    const c = new Clock();
    c.paused = true;
    expect(c.advance(1)).toBe(0);
  });
});

describe('Box', () => {
  it('toLocal and toWorld round-trip, including rotation', () => {
    const b = new Box(320, 240, 300, 200, 0.7);
    const w = b.toWorld({ x: 40, y: -25 });
    const l = b.toLocal(w);
    expect(l.x).toBeCloseTo(40);
    expect(l.y).toBeCloseTo(-25);
  });
  it('local origin is the box center', () => {
    expect(new Box(100, 50, 10, 10).toWorld({ x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
  });
  it('clamps a circle inside the interior', () => {
    const b = new Box(0, 0, 100, 60);
    expect(b.clampLocal({ x: 999, y: -999 }, 3)).toEqual({ x: 47, y: -27 });
  });
});

describe('Soul', () => {
  const box = new Box(0, 0, 1000, 1000);

  it('collision radius is the drawn radius', () => {
    expect(new Soul().hitRadius).toBe(SOUL_RADIUS);
  });
  it('moves at SOUL_SPEED, same speed on diagonals', () => {
    const s = new Soul();
    s.move({ dx: 1, dy: 0, slow: false }, 1, box);
    expect(s.pos.x).toBeCloseTo(SOUL_SPEED);
    const d = new Soul();
    d.move({ dx: 1, dy: 1, slow: false }, 1, box);
    expect(Math.hypot(d.pos.x, d.pos.y)).toBeCloseTo(SOUL_SPEED);
  });
  it('slow mode scales speed', () => {
    const s = new Soul();
    s.move({ dx: -1, dy: 0, slow: true }, 1, box);
    expect(s.pos.x).toBeCloseTo(-SOUL_SPEED * SLOW_MULTIPLIER);
  });
  it('cannot leave the box', () => {
    const small = new Box(0, 0, 100, 60);
    const s = new Soul();
    for (let i = 0; i < 600; i++) s.move({ dx: 1, dy: 1, slow: false }, STEP, small);
    expect(s.pos).toEqual({ x: 50 - SOUL_RADIUS, y: 30 - SOUL_RADIUS });
  });
  it('normal hit applies once, then i-frames block', () => {
    const s = new Soul();
    expect(s.damage({ amount: 10, type: 'normal' })).toBe('applied');
    expect(s.damage({ amount: 10, type: 'normal' })).toBe('blocked');
    expect(s.hp).toBe(MAX_HP - 10);
    expect(s.iframes).toBe(IFRAME_DURATION);
  });
  it('i-frames expire', () => {
    const s = new Soul();
    s.damage({ amount: 10, type: 'normal' });
    for (let t = 0; t < IFRAME_DURATION + STEP; t += STEP) s.tick(STEP);
    expect(s.invulnerable).toBe(false);
    expect(s.damage({ amount: 10, type: 'normal' })).toBe('applied');
  });
  it('KR fills a pool that drains HP over time, through i-frames', () => {
    const s = new Soul();
    s.damage({ amount: 20, type: 'kr' });
    expect(s.hp).toBe(MAX_HP);
    expect(s.kr).toBe(20);
    expect(s.invulnerable).toBe(true);
    s.tick(0.5);
    expect(s.hp).toBeCloseTo(MAX_HP - KR_DRAIN_RATE * 0.5);
    expect(s.kr).toBeCloseTo(20 - KR_DRAIN_RATE * 0.5);
    s.tick(100);
    expect(s.hp).toBeCloseTo(MAX_HP - 20);
    expect(s.kr).toBe(0);
  });
  it('KR alone cannot kill', () => {
    const s = new Soul();
    s.damage({ amount: MAX_HP - 5, type: 'normal' });
    s.iframes = 0;
    s.damage({ amount: 50, type: 'kr' });
    s.tick(100);
    expect(s.hp).toBe(1);
    expect(s.alive).toBe(true);
  });
  it('normal damage can kill', () => {
    const s = new Soul();
    expect(s.damage({ amount: MAX_HP, type: 'normal' })).toBe('dead');
    expect(s.alive).toBe(false);
  });
});
