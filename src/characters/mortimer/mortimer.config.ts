import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm, type Part } from '../../combat/composite';

export type MortimerAttack = 'snowfall' | 'roll' | 'blizzard';

export interface MortimerRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals. */
  breather: number;
  /** Phase order. Each attack is its own phase; only unlocked attacks take part, so L1-5 is snowfall, breather, snowfall... */
  phaseOrder: readonly MortimerAttack[];
  /** Snowfall: distance between flake slots along the top edge (px), flake radius (px, center to arm tip), sway frequency (rad/s), speed spread (up to this fraction faster, starting further away so arrival is unchanged), slow spin (rad/s). */
  flakeSpacing: number;
  flakeSize: number;
  flakeSpin: number;
  swayFreq: number;
  flakeSpeedSpread: number;
  /** Snowball roll: rows (slots) along a side the balls can roll in on. */
  rollLanes: number;
  /** Blizzard: distance between gust streaks down a side (px), streak thickness (px), seconds between waves of one gust. */
  gustSpacing: number;
  gustThickness: number;
  gustWaveGap: number;
  /** Blizzard: how far a gust streak bows (px) and how many straight pieces draw (and hit) its curve. */
  gustBend: number;
  gustSegments: number;
}

/**
 * Mortimer G. Frostwick Jr. (three stacked circles, pale ice): a SUPPORT character. Every projectile
 * is blue, which only hurts while a direction is held or during a dash, so alone he is nearly
 * harmless to a still soul; stacked with characters that force movement he is dangerous. That is
 * intentional: nothing here punishes standing still.
 * Unlocked attacks alternate in phases (one attack per phase, phaseLength s, breather between).
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  snowfall: cooldown s, damage, speed px/s (downward), count (flakes per row), sway px (amplitude)
 *  roll:     cooldown s, damage, speed px/s, count (balls per roll), size px (start radius), growth px/s (radius gain)
 *  blizzard: cooldown s, damage, speed px/s, count (waves per gust), length px (streak length)
 */
export const mortimerConfig: CharacterConfig<MortimerAttack, MortimerRules> = {
  id: 'mortimer',
  title: 'Mortimer G. Frostwick Jr.',
  description: 'Prefers you hold very, very still.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        snowfall: { cooldown: [1.2, 0.95], damage: [3, 4], speed: [px(35), px(40)], count: [5, 6], sway: [px(14), px(16)] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        snowfall: { cooldown: [0.9, 0.65], damage: [4, 6], speed: [px(40), px(52)], count: [6, 8], sway: [px(16), px(20)] },
        roll: { cooldown: [3.2, 2.3], damage: [6, 9], speed: [px(80), px(105)], count: [1, 2], size: [px(8), px(9)], growth: [px(1.5), px(1.8)] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        snowfall: { cooldown: [0.6, 0.45], damage: [6, 8], speed: [px(52), px(62)], count: [8, 10], sway: [px(20), px(24)] },
        roll: { cooldown: [2.2, 1.6], damage: [9, 12], speed: [px(105), px(125)], count: [2, 2], size: [px(9), px(10)], growth: [px(1.8), px(2)] },
        blizzard: { cooldown: [3, 2.4], damage: [8, 10], speed: [px(200), px(240)], count: [3, 4], length: [px(26), px(30)] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['snowfall', 'roll', 'blizzard'],
    flakeSpacing: px(18),
    flakeSize: px(6),
    flakeSpin: 1.2,
    swayFreq: 1.6,
    flakeSpeedSpread: 0.15,
    rollLanes: 3,
    gustSpacing: px(14),
    gustThickness: px(2.5),
    gustWaveGap: 0.12,
    gustBend: px(4),
    gustSegments: 6,
  },
};

const flakes = new Map<number, CompositeForm>();
/**
 * A cute six-armed snowflake of radius R (center to arm tip): a small hub, six thin arms and a pair
 * of short side branches on each arm. Every part is drawn and collided (combat/composite.ts).
 */
export function snowflakeForm(R: number): CompositeForm {
  let f = flakes.get(R);
  if (f) return f;
  const parts: Part[] = [{ kind: 'circle', x: 0, y: 0, r: R * 0.24 }];
  const t = Math.max(0.9, R * 0.11); // arm half-thickness
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push({ kind: 'rect', x: (c * R) / 2, y: (s * R) / 2, hw: R / 2, hh: t, rot: a });
    // Two branches at 60% of the arm, angled 50 degrees off it, outward.
    const bx = c * R * 0.6, by = s * R * 0.6, L = R * 0.34;
    for (const k of [-1, 1]) {
      const b = a + k * 0.87;
      parts.push({ kind: 'rect', x: bx + (Math.cos(b) * L) / 2, y: by + (Math.sin(b) * L) / 2, hw: L / 2, hh: t * 0.85, rot: b });
    }
  }
  f = makeForm(parts);
  flakes.set(R, f);
  return f;
}
