import type { World } from '../core/World';
import { aimed, fan, line, ring } from '../combat/patterns';

/**
 * Short looping demo built from the patterns, so BattleScene has something to
 * dodge until the Director and characters exist (Phase 4). Deterministic: no randomness.
 */
type Cue = { at: number; fire: (w: World) => void };

const LOOP = 10;

const cues: Cue[] = [
  { at: 0.5, fire: (w) => line(w.pool, w.box, { edge: 'left', count: 10, speed: 120, gaps: [3, 4], style: { a: 6, damage: 6 } }) },
  {
    at: 1.8,
    fire: (w) => {
      const { halfWidth: hw, halfHeight: hh } = w.box;
      aimed(w.pool, { x: -hw, y: -hh - 10, target: w.soul.pos, speed: 200, style: { a: 5, damage: 8 } });
      aimed(w.pool, { x: hw, y: -hh - 10, target: w.soul.pos, speed: 200, style: { a: 5, damage: 8 } });
    },
  },
  {
    at: 3.0,
    fire: (w) =>
      ring(w.pool, {
        x: -w.box.halfWidth, y: -w.box.halfHeight, count: 18, speed: 95,
        style: { shape: 'triangle', a: 7, spin: 4, damage: 7 },
      }),
  },
  {
    at: 4.6,
    fire: (w) =>
      fan(w.pool, {
        x: 0, y: w.box.halfHeight + 10, angle: -Math.PI / 2, count: 7, spread: 1.3, speed: 140,
        style: { shape: 'rect', a: 6, b: 3, faceVelocity: true, damage: 7 },
      }),
  },
  {
    at: 6.0,
    fire: (w) =>
      w.pool.spawn({
        shape: 'beam', x: -w.box.halfWidth * 0.35, y: -w.box.halfHeight - 8, vy: 70,
        a: w.box.width * 0.6, b: 6, damage: 20, type: 'kr',
      }),
  },
  { at: 7.4, fire: (w) => line(w.pool, w.box, { edge: 'right', count: 10, speed: 130, gaps: [6, 7], style: { a: 6, damage: 6 } }) },
  {
    at: 8.6,
    fire: (w) =>
      aimed(w.pool, { x: 0, y: -w.box.halfHeight - 10, target: w.soul.pos, speed: 170, count: 3, spread: 0.5, style: { a: 5, damage: 8 } }),
  },
];

export class Demo {
  private t = 0;
  private next = 0;

  step(w: World, dt: number): void {
    this.t += dt;
    while (this.next < cues.length && this.t >= cues[this.next]!.at) cues[this.next++]!.fire(w);
    if (this.t >= LOOP) {
      this.t -= LOOP;
      this.next = 0;
    }
  }
}
