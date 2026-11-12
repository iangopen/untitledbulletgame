import type { CharacterConfig } from '../config';
import { px } from '../../tuning';

export type PrismAttack = 'volley' | 'beam' | 'prism';
export type PrismPhase = 'wall' | 'ray';

export interface PrismRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals, so the switch reads. */
  breather: number;
  /** Cooldowns are divided by this inside their phase (2 = twice the per-level intensity). */
  phaseIntensity: number;
  /** Phase order; the battle starts in the first. */
  phaseOrder: readonly PrismPhase[];
  /** Which phase each attack belongs to; an attack only runs in its own phase. */
  attackPhase: Readonly<Record<PrismAttack, PrismPhase>>;
  /** Beams fanned out by a refraction prism (the only way a ray multiplies). */
  refractCount: number;
  /** DESIGN DEFAULT (Ian may change): touching the refraction prism does no damage. */
  prismHarmless: boolean;
  /** Prism circumradius in px. */
  prismRadius: number;
  /** Refraction prism placement: clear distance from the box wall beyond its radius (px), and how much farther out it may stand (px). */
  prismGap: number;
  prismSpread: number;
  /** Volley bullet circumradius (px). */
  volleySize: number;
  /** Constant distance between neighbouring volley triangles (px), at every level and on every edge. */
  volleySpacing: number;
  /** Beam thickness (px). */
  beamThickness: number;
}

/**
 * Prism (cyan triangle): pure dodging, no box effect. Two alternating phases at every level:
 * wall (edge volleys only) and ray (beams + refraction prism only), each phaseLength seconds with a
 * breather between, at phaseIntensity x the band's rate. Every projectile is white and enters from
 * off screen; rays never split at walls and only multiply through the prism.
 * Params per attack (all [bandStart, bandEnd]); cooldowns are the base rate before phaseIntensity.
 * Distances/speeds are written as px(original 640x480 value); see WORLD_SCALE in tuning.ts.
 *  volley: cooldown s, damage, speed px/s, gapSize (empty slots in the one safe gap). Slots are
 *          rules.volleySpacing apart, as many as fit along the edge (13 on top/bottom, 10 on the sides
 *          of the default box).
 *  beam:   cooldown s, damage, speed px/s, count (beams per shot), length px
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
        volley: { cooldown: [2.6, 1.8], damage: [4, 6], speed: [px(70), px(95)], gapSize: [5, 3] },
        beam: { cooldown: [3.8, 3.3], damage: [4, 6], speed: [px(220), px(255)], count: [1, 1], length: [px(30), px(33)] },
        prism: { cooldown: [10, 9.5], refractSpread: [0.5, 0.55], aimChance: [0.3, 0.4] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        volley: { cooldown: [1.75, 1.3], damage: [6, 9], speed: [px(95), px(125)], gapSize: [3, 2] },
        beam: { cooldown: [3.2, 1.8], damage: [6, 10], speed: [px(260), px(360)], count: [1, 2], length: [px(34), px(40)] },
        prism: { cooldown: [9.5, 9], refractSpread: [0.55, 0.6], aimChance: [0.4, 0.5] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        volley: { cooldown: [1.25, 1.0], damage: [9, 12], speed: [px(125), px(145)], gapSize: [2, 2] },
        beam: { cooldown: [1.75, 1.4], damage: [10, 13], speed: [px(360), px(400)], count: [2, 3], length: [px(40), px(40)] },
        prism: { cooldown: [9, 6], refractSpread: [0.6, 0.9], aimChance: [0.5, 0.7] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseIntensity: 2,
    phaseOrder: ['wall', 'ray'],
    attackPhase: { volley: 'wall', beam: 'ray', prism: 'ray' },
    refractCount: 3,
    prismHarmless: true,
    prismRadius: px(28),
    prismGap: px(12),
    prismSpread: px(70),
    volleySize: px(6),
    volleySpacing: px(22),
    beamThickness: px(4),
  },
};
