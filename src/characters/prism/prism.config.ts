import type { CharacterConfig } from '../config';
import { px } from '../../tuning';

export type PrismAttack = 'volley' | 'beam' | 'prism';

export interface PrismRules {
  /** Beams with gen below this split at walls. 1 = only originals split; children never do. Raising it multiplies bullets exponentially. */
  splitMaxGeneration: number;
  /** Whether beams created by the refraction prism may still split at walls. */
  refractedCanSplit: boolean;
  /** Beams fanned out by a refraction prism. */
  refractCount: number;
  /** DESIGN DEFAULT (Ian may change): touching the refraction prism does no damage. */
  prismHarmless: boolean;
  /** Prism circumradius in px. */
  prismRadius: number;
  /** Volley bullet circumradius, beam thickness (px). */
  volleySize: number;
  beamThickness: number;
}

/**
 * Prism (cyan triangle): pure dodging, no box effect.
 * Params per attack (all [bandStart, bandEnd]):
 * Distances/speeds are written as px(original 640x480 value); see WORLD_SCALE in tuning.ts.
 *  volley: cooldown s, damage, speed px/s, count (bullets in the row), gapSize (empty slots)
 *  beam:   cooldown s, damage, speed px/s, count (beams per shot), length px, splitSpread rad (angle between the two halves)
 *  prism:  cooldown s (how often the prism relocates), refractSpread rad (fan width), aimChance (share of beams aimed through the prism)
 */
export const prismConfig: CharacterConfig<PrismAttack, PrismRules> = {
  id: 'prism',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        volley: { cooldown: [2.6, 1.8], damage: [4, 6], speed: [px(70), px(95)], count: [8, 10], gapSize: [3, 2] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        volley: { cooldown: [1.75, 1.3], damage: [6, 9], speed: [px(95), px(125)], count: [10, 12], gapSize: [2, 2] },
        beam: { cooldown: [3.2, 1.8], damage: [6, 10], speed: [px(130), px(180)], count: [1, 2], length: [px(34), px(40)], splitSpread: [0.5, 0.65] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        volley: { cooldown: [1.25, 1.0], damage: [9, 12], speed: [px(125), px(145)], count: [12, 12], gapSize: [2, 2] },
        beam: { cooldown: [1.75, 1.4], damage: [10, 13], speed: [px(180), px(200)], count: [2, 3], length: [px(40), px(40)], splitSpread: [0.65, 0.75] },
        prism: { cooldown: [9, 6], refractSpread: [0.6, 0.9], aimChance: [0.5, 0.7] },
      },
    },
  ],
  rules: {
    splitMaxGeneration: 1,
    refractedCanSplit: false,
    refractCount: 3,
    prismHarmless: true,
    prismRadius: px(28),
    volleySize: px(6),
    beamThickness: px(4),
  },
};
