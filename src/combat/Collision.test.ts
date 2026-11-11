import { describe, expect, it } from 'vitest';
import { circleVsCircle, circleVsRect, circleVsTriangle, distSqPointSegment, pointInTriangle } from './Collision';

describe('circleVsCircle', () => {
  it('overlapping', () => expect(circleVsCircle({ x: 0, y: 0, r: 5 }, { x: 6, y: 0, r: 2 })).toBe(true));
  it('exactly touching counts', () => expect(circleVsCircle({ x: 0, y: 0, r: 3 }, { x: 5, y: 0, r: 2 })).toBe(true));
  it('separate', () => expect(circleVsCircle({ x: 0, y: 0, r: 3 }, { x: 5.01, y: 0, r: 2 })).toBe(false));
  it('diagonal uses euclidean distance', () =>
    expect(circleVsCircle({ x: 0, y: 0, r: 2 }, { x: 3, y: 3, r: 2 })).toBe(false));
  it('one inside the other', () => expect(circleVsCircle({ x: 0, y: 0, r: 10 }, { x: 1, y: 1, r: 1 })).toBe(true));
});

describe('circleVsRect', () => {
  const rect = { x: 0, y: 0, hw: 10, hh: 5 };
  it('center inside', () => expect(circleVsRect({ x: 3, y: 2, r: 1 }, rect)).toBe(true));
  it('touching an edge', () => expect(circleVsRect({ x: 12, y: 0, r: 2 }, rect)).toBe(true));
  it('just off an edge', () => expect(circleVsRect({ x: 12.01, y: 0, r: 2 }, rect)).toBe(false));
  it('near a corner but outside (diagonal)', () => expect(circleVsRect({ x: 12, y: 7, r: 2.5 }, rect)).toBe(false));
  it('overlapping a corner', () => expect(circleVsRect({ x: 11, y: 6, r: 2 }, rect)).toBe(true));
  it('respects rotation', () => {
    const rotated = { x: 0, y: 0, hw: 10, hh: 1, rotation: Math.PI / 2 };
    expect(circleVsRect({ x: 0, y: 8, r: 0.5 }, rotated)).toBe(true);
    expect(circleVsRect({ x: 8, y: 0, r: 0.5 }, rotated)).toBe(false);
  });
});

describe('circleVsTriangle', () => {
  const tri = { ax: 0, ay: 0, bx: 10, by: 0, cx: 0, cy: 10 };
  const triCw = { ax: 0, ay: 0, bx: 0, by: 10, cx: 10, cy: 0 };
  it('center inside', () => expect(circleVsTriangle({ x: 2, y: 2, r: 0.5 }, tri)).toBe(true));
  it('inside regardless of winding', () => expect(circleVsTriangle({ x: 2, y: 2, r: 0.5 }, triCw)).toBe(true));
  it('touches an edge from outside', () => expect(circleVsTriangle({ x: 5, y: -1, r: 1 }, tri)).toBe(true));
  it('misses past the hypotenuse', () => expect(circleVsTriangle({ x: 7, y: 7, r: 1 }, tri)).toBe(false));
  it('hits the hypotenuse', () => expect(circleVsTriangle({ x: 6, y: 6, r: 1.5 }, tri)).toBe(true));
  it('misses near a vertex', () => expect(circleVsTriangle({ x: -1, y: -1, r: 1 }, tri)).toBe(false));
  it('big circle containing the triangle', () => expect(circleVsTriangle({ x: 3, y: 3, r: 50 }, tri)).toBe(true));
});

describe('helpers', () => {
  it('distSqPointSegment clamps to endpoints', () => {
    expect(distSqPointSegment(-3, 4, 0, 0, 10, 0)).toBe(25);
    expect(distSqPointSegment(5, 2, 0, 0, 10, 0)).toBe(4);
    expect(distSqPointSegment(3, 4, 0, 0, 0, 0)).toBe(25);
  });
  it('pointInTriangle includes edges', () => {
    expect(pointInTriangle(5, 0, { ax: 0, ay: 0, bx: 10, by: 0, cx: 0, cy: 10 })).toBe(true);
  });
});
