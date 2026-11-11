import { describe, expect, it } from 'vitest';
import { FrameStats, percentile } from './frameStats';

describe('FrameStats', () => {
  it('summarises fps, steps histogram and dropped frames', () => {
    const s = new FrameStats(10);
    for (let i = 0; i < 8; i++) s.push({ interval: 1000 / 120, work: 1, steps: i % 2 });
    s.push({ interval: 25, work: 9, steps: 2 });
    s.push({ interval: 1000 / 120, work: 2, steps: 3 });
    const r = s.summary();
    expect(r.frames).toBe(10);
    expect(r.stepHist).toEqual([4, 4, 1, 1]);
    expect(r.dropped).toBe(1);
    expect(r.intervalMedian).toBeCloseTo(1000 / 120);
    expect(r.workMax).toBe(9);
  });

  it('is a ring buffer and returns recent work oldest first', () => {
    const s = new FrameStats(3);
    for (let i = 1; i <= 5; i++) s.push({ interval: 16, work: i, steps: 1 });
    expect(s.count).toBe(3);
    expect(s.recentWork(10)).toEqual([3, 4, 5]);
    expect(s.recentWork(2)).toEqual([4, 5]);
  });

  it('percentile handles empty and ordered input', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
  });
});
