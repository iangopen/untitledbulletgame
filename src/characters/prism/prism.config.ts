import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm } from '../../combat/composite';

/**
 * Prism's attacks: Refraction = 'beam' (light rays) + 'prism' (refraction prism), both in the ray
 * phase; 'mirrors' (Mirrors, L6+) and 'blaster' (Blaster, L15+) are one phase each.
 */
export type PrismAttack = 'beam' | 'prism' | 'mirrors' | 'blaster';
/** Phases: ray (Refraction), mirrors, blaster. Only phases with an unlocked attack take part. */
export type PrismPhase = 'ray' | 'mirrors' | 'blaster';

export interface PrismRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals, so the switch reads. */
  breather: number;
  /** Refraction's cooldowns are divided by this inside the ray phase (2 = twice the per-level intensity). */
  phaseIntensity: number;
  /** Phase order; only phases with an unlocked attack take part (L1-5 ray; L6-14 ray, mirrors; L15-20 all three). */
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
  /** Beam thickness (px), for rays and the mirror beam. */
  beamThickness: number;
  /** Mirrors: half length and thickness of a mirror (px), distance from the wall to its center (px). */
  mirrorSize: number;
  mirrorThickness: number;
  mirrorGap: number;
  /** Mirrors: share of volleys that bounce between the left and right walls (the rest top and bottom). */
  mirrorSideways: number;
  /** Blaster: emitter size (px), distance from the wall to the emitter's center (px). */
  emitterSize: number;
  emitterGap: number;
  /** Blaster: laser length (px, from the emitter's mouth through the box), full thickness of the laser and of its warning line (px). */
  laserLength: number;
  laserThickness: number;
  warnThickness: number;
  /** Blaster: seconds the laser fires (collides) after the warning. */
  laserTime: number;
  /** Blaster: the warning line never shows for less than this (s), at any level. */
  minWarn: number;
  /** Blaster: largest angle (rad) off the horizontal; the laser and its warning stay between the HUD bands. */
  laserMaxAngle: number;
}

/**
 * Prism (cyan triangle): light attacks, no box effect. Every projectile is white.
 * Phases cycle through only the unlocked attacks (shared phases.ts), phaseLength s each with a
 * breather between: Refraction (ray) first, so the first ray reaches the box about 1 s in.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  beam:    cooldown s (before phaseIntensity), damage, speed px/s, count (beams per shot), length px
 *  prism:   cooldown s (how often the prism relocates), refractSpread rad (fan width), aimChance (share of beams aimed through the prism)
 *  mirrors: cooldown s, damage, speed px/s (the beam), count (mirrors = bounces), read s (mirrors show gold
 *           before the beam fires), length px (beam)
 *  blaster: cooldown s, damage, count (emitters per volley), warn s (warning line; never below
 *           rules.minWarn), stagger s (between emitters firing; lower = back to back)
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
        mirrors: { cooldown: [3.6, 3.0], damage: [6, 9], speed: [px(280), px(340)], count: [2, 3], read: [1.0, 0.8], length: [px(40), px(48)] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        beam: { cooldown: [1.75, 1.4], damage: [10, 13], speed: [px(360), px(400)], count: [2, 3], length: [px(40), px(40)] },
        prism: { cooldown: [9, 6], refractSpread: [0.6, 0.9], aimChance: [0.5, 0.7] },
        mirrors: { cooldown: [3.0, 2.6], damage: [9, 12], speed: [px(340), px(400)], count: [3, 5], read: [0.8, 0.6], length: [px(48), px(54)] },
        blaster: { cooldown: [2.4, 1.8], damage: [10, 14], count: [2, 4], warn: [0.55, 0.35], stagger: [0.35, 0.2] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseIntensity: 2,
    phaseOrder: ['ray', 'mirrors', 'blaster'],
    attackPhase: { beam: 'ray', prism: 'ray', mirrors: 'mirrors', blaster: 'blaster' },
    refractCount: 3,
    prismHarmless: true,
    prismRadius: px(28),
    prismGap: px(12),
    prismSpread: px(70),
    beamThickness: px(4),
    mirrorSize: px(12),
    mirrorThickness: px(2.5),
    mirrorGap: px(22),
    mirrorSideways: 0.75,
    emitterSize: px(12),
    emitterGap: px(26),
    laserLength: px(740),
    laserThickness: px(12),
    warnThickness: px(1.5),
    laserTime: 0.3,
    minWarn: 0.25,
    laserMaxAngle: 0.3,
  },
};

const mirrors = new Map<string, CompositeForm>();
/** A mirror (decor) along +x: a flat bar `2 size` long with a short backing stub behind its middle. */
export function mirrorForm(size: number, thickness: number): CompositeForm {
  const key = `${size}:${thickness}`;
  let f = mirrors.get(key);
  if (!f) {
    f = makeForm([
      { kind: 'rect', x: 0, y: 0, hw: size, hh: thickness / 2 },
      { kind: 'rect', x: 0, y: thickness * 1.2, hw: size * 0.35, hh: thickness * 0.55 },
    ]);
    mirrors.set(key, f);
  }
  return f;
}

const emitters = new Map<number, CompositeForm>();
/**
 * A blaster emitter (decor) facing +x, radius R: a blocky head with two eye slits and an open jaw
 * (upper and lower fangs) whose mouth is at x = R, where the laser starts.
 */
export function emitterForm(R: number): CompositeForm {
  let f = emitters.get(R);
  if (!f) {
    f = makeForm([
      { kind: 'rect', x: -R * 0.35, y: 0, hw: R * 0.55, hh: R * 0.6 },
      { kind: 'tri', ax: R * 0.2, ay: -R * 0.6, bx: R, by: -R * 0.18, cx: R * 0.2, cy: -R * 0.12 },
      { kind: 'tri', ax: R * 0.2, ay: R * 0.6, bx: R, by: R * 0.18, cx: R * 0.2, cy: R * 0.12 },
      { kind: 'tri', ax: -R * 0.9, ay: -R * 0.6, bx: -R * 0.9, by: -R * 0.95, cx: -R * 0.45, cy: -R * 0.6 },
      { kind: 'tri', ax: -R * 0.9, ay: R * 0.6, bx: -R * 0.9, by: R * 0.95, cx: -R * 0.45, cy: R * 0.6 },
    ]);
    emitters.set(R, f);
  }
  return f;
}
