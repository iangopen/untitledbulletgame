import type { CharacterConfig } from '../config';
import { px } from '../../tuning';

export type MortimerAttack = 'snowfall' | 'roll' | 'blizzard';

export interface MortimerRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals. */
  breather: number;
  /** Phase order. Each attack is its own phase; only unlocked attacks take part, so L1-5 is snowfall, breather, snowfall... */
  phaseOrder: readonly MortimerAttack[];
  /** Snowfall: distance between flake slots along the top edge (px), flake radius (px), sway frequency (rad/s), speed spread (up to this fraction faster, starting further away so arrival is unchanged). */
  flakeSpacing: number;
  flakeSize: number;
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
    flakeSize: px(4),
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
