import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm, type Part } from '../../combat/composite';

export type EmberAttack = 'embers' | 'sweep' | 'wildfire';

export interface EmberRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals. */
  breather: number;
  /** Phase order; one phase per unlocked attack (L1-5: embers, breather, embers ...). */
  phaseOrder: readonly EmberAttack[];
  /** Embers: distance between flame slots along the bottom edge (px), drift frequency (rad/s), speed spread (fraction faster, starting further away). */
  sparkSpacing: number;
  driftFreq: number;
  sparkSpeedSpread: number;
  /** Fire sweep: thickness of the flame wall's core (px), seconds between the walls of one sweep. */
  sweepThickness: number;
  sweepWaveGap: number;
  /** Wildfire: gap from the box wall to a ring's center (px), seconds between the rings of one volley. */
  ringGap: number;
  ringStagger: number;
  /** Wildfire warning: seconds the fire icon blinks at a ring's center before the ring goes off, blink rate (Hz), icon size (px, half height). */
  ringWarn: number;
  ringWarnBlink: number;
  ringWarnSize: number;
  /** Visual-only flicker of every flame (drawn alpha dip, 0..1; never the hitbox). */
  fireFlicker: number;
}

/**
 * Ember (teardrop flame, pale flame peach): a SUPPORT character mirroring Mortimer. Every projectile
 * is ORANGE, which only hurts while the soul is standing still, so alone a soul that keeps moving
 * takes no damage; stacked with characters that reward standing still (or punish moving: Mortimer's
 * blue) he is dangerous. That is intentional: nothing here punishes moving.
 * Unlocked attacks alternate in phases (one attack per phase, phaseLength s, breather between).
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  embers:   cooldown s, damage, speed px/s (upward), count (flames per row), drift px (sway amplitude), size px (flame body radius)
 *  sweep:    cooldown s, damage, speed px/s, count (walls per sweep), cover (fraction of the box height the wall covers)
 *  wildfire: cooldown s, damage, speed px/s (ring growth), count (rings per volley), thickness px
 */
export const emberConfig: CharacterConfig<EmberAttack, EmberRules> = {
  id: 'ember',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        embers: { cooldown: [1.1, 0.9], damage: [3, 4], speed: [px(45), px(52)], count: [4, 5], drift: [px(10), px(12)], size: [px(3.5), px(3.5)] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        embers: { cooldown: [0.85, 0.6], damage: [4, 6], speed: [px(52), px(66)], count: [5, 7], drift: [px(12), px(16)], size: [px(3.5), px(4)] },
        sweep: { cooldown: [3.4, 2.6], damage: [6, 9], speed: [px(80), px(92)], count: [1, 2], cover: [0.7, 0.8] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        embers: { cooldown: [0.6, 0.45], damage: [6, 8], speed: [px(66), px(78)], count: [7, 9], drift: [px(16), px(20)], size: [px(4), px(4)] },
        sweep: { cooldown: [2.6, 2.1], damage: [9, 11], speed: [px(92), px(105)], count: [2, 2], cover: [0.8, 0.88] },
        wildfire: { cooldown: [2.6, 2.0], damage: [8, 10], speed: [px(90), px(110)], count: [1, 2], thickness: [px(6), px(7)] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['embers', 'sweep', 'wildfire'],
    sparkSpacing: px(18),
    driftFreq: 2.2,
    sparkSpeedSpread: 0.2,
    sweepThickness: px(7),
    sweepWaveGap: 0.6,
    ringGap: px(16),
    ringStagger: 0.45,
    ringWarn: 0.6,
    ringWarnBlink: 5,
    ringWarnSize: px(12),
    fireFlicker: 0.35,
  },
};

const walls = new Map<string, CompositeForm>();
/** Forward tongue lengths along a fire wall, in core thicknesses (a fixed ragged pattern). */
const WALL_TONGUES = [1.1, 2.1, 1.4, 2.6, 1.0, 1.8, 1.3, 2.3];
/**
 * A wall of fire `length` px long (across its travel, +y), pointing +x (where it travels): a solid
 * core `thickness` wide, a ragged row of flame tongues (triangles of varied length) licking forward,
 * round flame bulbs along the front of the core, and short tongues trailing behind. Every part is
 * drawn and collided (combat/composite.ts); the flicker is drawn alpha only.
 */
export function flameWallForm(length: number, thickness: number): CompositeForm {
  const key = `${length.toFixed(2)}:${thickness.toFixed(2)}`;
  let f = walls.get(key);
  if (f) return f;
  const hh = length / 2;
  const t = thickness / 2;
  const parts: Part[] = [{ kind: 'rect', x: 0, y: 0, hw: t, hh }];
  const n = Math.max(2, Math.round(length / px(11)));
  const w = length / n;
  for (let i = 0; i < n; i++) {
    const y0 = -hh + i * w;
    const reach = t + thickness * WALL_TONGUES[i % WALL_TONGUES.length]!;
    // Tongues lean a little toward one side, like flames in a draft.
    parts.push({ kind: 'tri', ax: t - 0.5, ay: y0, bx: t - 0.5, by: y0 + w, cx: reach, cy: y0 + w * (i % 3 === 0 ? 0.3 : 0.62) });
    if (i % 2 === 0) parts.push({ kind: 'circle', x: t, y: y0 + w / 2, r: Math.min(w / 2, thickness * 0.55) });
    if (i % 2 === 1) parts.push({ kind: 'tri', ax: -t + 0.5, ay: y0, bx: -t + 0.5, by: y0 + w, cx: -t - thickness * 0.7, cy: y0 + w / 2 });
  }
  f = makeForm(parts);
  walls.set(key, f);
  return f;
}

const flames = new Map<number, CompositeForm>();
/**
 * A small flame of base radius r, pointing +x (where it flies): a round body, a main tongue to a
 * tip 2.6 r ahead and two short side flicks. Drawn and collided from the same parts.
 */
export function emberFlameForm(r: number): CompositeForm {
  let f = flames.get(r);
  if (f) return f;
  f = makeForm([
    { kind: 'circle', x: 0, y: 0, r },
    { kind: 'tri', ax: 0, ay: -r * 0.95, bx: 0, by: r * 0.95, cx: r * 2.6, cy: 0 },
    { kind: 'tri', ax: r * 0.2, ay: -r * 0.85, bx: r * 0.9, by: -r * 0.55, cx: r * 1.5, cy: -r * 1.15 },
    { kind: 'tri', ax: r * 0.2, ay: r * 0.85, bx: r * 0.9, by: r * 0.55, cx: r * 1.3, cy: r * 1.1 },
  ]);
  flames.set(r, f);
  return f;
}

/**
 * The wildfire warning icon (decor: never collides): a fire symbol, pointing up the screen (-y),
 * of height about 2R: a round base and a flame tip, with a small inner notch tongue.
 */
export function fireIconForm(R: number): CompositeForm {
  return makeForm([
    { kind: 'circle', x: 0, y: R * 0.3, r: R * 0.62 },
    { kind: 'tri', ax: -R * 0.62, ay: R * 0.25, bx: R * 0.62, by: R * 0.25, cx: R * 0.12, cy: -R * 1.05 },
    { kind: 'tri', ax: -R * 0.6, ay: R * 0.1, bx: -R * 0.1, by: R * 0.1, cx: -R * 0.55, cy: -R * 0.45 },
  ]);
}
