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
  /** Embers: distance between spark slots along the bottom edge (px), drift frequency (rad/s), flicker (radius pulse fraction and rad/s), speed spread (fraction faster, starting further away). */
  sparkSpacing: number;
  driftFreq: number;
  flicker: number;
  flickerFreq: number;
  sparkSpeedSpread: number;
  /** Fire sweep: thickness of the flame wall's core (px), seconds between the walls of one sweep. */
  sweepThickness: number;
  sweepWaveGap: number;
  /** Wildfire: gap from the box wall to a ring's center (px), seconds between the rings of one volley. */
  ringGap: number;
  ringStagger: number;
}

/**
 * Ember (teardrop flame, pale flame peach): a SUPPORT character mirroring Mortimer. Every projectile
 * is ORANGE, which only hurts while the soul is standing still, so alone a soul that keeps moving
 * takes no damage; stacked with characters that reward standing still (or punish moving: Mortimer's
 * blue) he is dangerous. That is intentional: nothing here punishes moving.
 * Unlocked attacks alternate in phases (one attack per phase, phaseLength s, breather between).
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  embers:   cooldown s, damage, speed px/s (upward), count (sparks per row), drift px (sway amplitude), size px (spark radius)
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
    flicker: 0.22,
    flickerFreq: 18,
    sparkSpeedSpread: 0.2,
    sweepThickness: px(7),
    sweepWaveGap: 0.6,
    ringGap: px(16),
    ringStagger: 0.45,
  },
};

const walls = new Map<string, CompositeForm>();
/**
 * A wall of flame `length` px long (across its travel, +y), pointing +x (where it travels): a solid
 * core `thickness` wide with a row of flame tongues (triangles) licking forward and a few short
 * ones trailing behind. Every part is drawn and collided (combat/composite.ts).
 */
export function flameWallForm(length: number, thickness: number): CompositeForm {
  const key = `${length.toFixed(2)}:${thickness.toFixed(2)}`;
  let f = walls.get(key);
  if (f) return f;
  const hh = length / 2;
  const t = thickness / 2;
  const parts: Part[] = [{ kind: 'rect', x: 0, y: 0, hw: t, hh }];
  const n = Math.max(2, Math.round(length / px(13)));
  const w = length / n;
  for (let i = 0; i < n; i++) {
    const y0 = -hh + i * w;
    // Forward tongues alternate long and short, so the front reads as flickering flame.
    const reach = t + (i % 2 === 0 ? thickness * 1.6 : thickness * 1.0);
    parts.push({ kind: 'tri', ax: t, ay: y0, bx: t, by: y0 + w, cx: reach, cy: y0 + w * (i % 3 === 0 ? 0.35 : 0.6) });
    if (i % 2 === 1) parts.push({ kind: 'tri', ax: -t, ay: y0, bx: -t, by: y0 + w, cx: -t - thickness * 0.6, cy: y0 + w / 2 });
  }
  f = makeForm(parts);
  walls.set(key, f);
  return f;
}
