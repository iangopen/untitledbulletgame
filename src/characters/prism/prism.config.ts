import type { CharacterConfig } from '../config';
import { px } from '../../tuning';

/**
 * Refraction = the 'beam' (light rays) and 'prism' (refraction prism) attacks, both in the ray phase.
 * Mirrors and Blaster (next session) add their own attack ids and phases here: give each a phase in
 * PrismPhase, put it in a 'rest' slot of phaseOrder and map it in attackPhase.
 */
export type PrismAttack = 'beam' | 'prism';
/** 'rest' = a quiet phase slot (where the old wall phase was; Mirrors and Blaster will take it). */
export type PrismPhase = 'rest' | 'ray';

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
  /** Beam thickness (px). */
  beamThickness: number;
}

/**
 * Prism (cyan triangle): pure dodging, no box effect. Light attacks. For now one attack at every
 * level, Refraction (the 'beam' rays and the 'prism' refraction prism, in the ray phase); its phase
 * slots alternate rest -> ray (the ray windows are the old Prism's: 9-17, 27-35, ...), each
 * phaseLength s with a breather between, at phaseIntensity x the band's rate. Every projectile is
 * white and enters from off screen; rays never split at walls and only multiply through the prism.
 * (The edge volleys moved to Rose, characters/rose/, with the same numbers.)
 * Params per attack (all [bandStart, bandEnd]); cooldowns are the base rate before phaseIntensity.
 * Distances/speeds are written as px(original 640x480 value); see WORLD_SCALE in tuning.ts.
 *  beam:   cooldown s, damage, speed px/s, count (beams per shot), length px
 *  prism:  cooldown s (how often the prism relocates), refractSpread rad (fan width), aimChance (share of beams aimed through the prism)
 */
export const prismConfig: CharacterConfig<PrismAttack, PrismRules> = {
  id: 'prism',
  title: 'Prism',
  description: 'Splits light into something far less friendly.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        beam: { cooldown: [3.8, 3.3], damage: [4, 6], speed: [px(220), px(255)], count: [1, 1], length: [px(30), px(33)] },
        prism: { cooldown: [10, 9.5], refractSpread: [0.5, 0.55], aimChance: [0.3, 0.4] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        beam: { cooldown: [3.2, 1.8], damage: [6, 10], speed: [px(260), px(360)], count: [1, 2], length: [px(34), px(40)] },
        prism: { cooldown: [9.5, 9], refractSpread: [0.55, 0.6], aimChance: [0.4, 0.5] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        beam: { cooldown: [1.75, 1.4], damage: [10, 13], speed: [px(360), px(400)], count: [2, 3], length: [px(40), px(40)] },
        prism: { cooldown: [9, 6], refractSpread: [0.6, 0.9], aimChance: [0.5, 0.7] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseIntensity: 2,
    phaseOrder: ['rest', 'ray'],
    attackPhase: { beam: 'ray', prism: 'ray' },
    refractCount: 3,
    prismHarmless: true,
    prismRadius: px(28),
    prismGap: px(12),
    prismSpread: px(70),
    beamThickness: px(4),
  },
};
