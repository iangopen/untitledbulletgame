import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm } from '../../combat/composite';

export type VesperAttack = 'throw' | 'encircle' | 'flurry';

export interface VesperRules {
  /** Phases cycle through only unlocked attacks: phaseLength s each, breather between. */
  phaseLength: number;
  breather: number;
  phaseOrder: readonly VesperAttack[];
  /** Knife length (tip to pommel, px) and blade width (px). */
  knifeLength: number;
  knifeWidth: number;
  /** Throw: knives of a burst leave one after another this far apart (s). */
  throwStagger: number;
  /** Encircle: the gap is never narrower than this (px) where an escaping soul crosses the closing ring (soul diameter 18 + room). */
  minGap: number;
  /** Encircle: the gold pause before the ring arms is never shorter than this (s). */
  minPause: number;
  /** Encircle: knife slots around a ring (evenly spaced; the gap removes some). */
  ringSlots: number;
  /** Encircle: seconds between the first ring arming and the second ring forming (two rings back to back). */
  ringGapTime: number;
  /** Flurry: slash warnings are never shorter than this (s). */
  minWarn: number;
  /** Flurry: seconds a slash collides once its warning ends. */
  slashTime: number;
  /** Flurry: slash thickness while active and while warning (px). */
  slashThickness: number;
  warnThickness: number;
  /** Flurry: lane spacing of stream knives along an edge (px). */
  streamSpacing: number;
}

/**
 * Vesper (assassin, steel; roster and profile only). Every knife is white.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  throw:    cooldown s, damage, count (knives per burst), speed px/s
 *  encircle: cooldown s, damage, radius px (ring radius; smaller = tighter), pause s (gold, never below
 *            rules.minPause), speed px/s (converging), rings (1 or 2 back to back), gap px (asked gap
 *            width; never below rules.minGap where the soul escapes)
 *  flurry:   cooldown s, damage, streams (edges pouring at once), count (knives per stream), stagger s
 *            (between knives of a stream; lower = denser), speed px/s, slashes (per volley), warn s
 *            (slash warning; never below rules.minWarn)
 */
export const vesperConfig: CharacterConfig<VesperAttack, VesperRules> = {
  id: 'vesper',
  title: 'Vesper',
  description: 'You won’t see her coming. That’s rather the point.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        throw: { cooldown: [1.5, 1.2], damage: [5, 7], count: [3, 4], speed: [px(220), px(230)] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        throw: { cooldown: [1.2, 0.95], damage: [7, 10], count: [4, 6], speed: [px(230), px(250)] },
        encircle: { cooldown: [3.2, 2.7], damage: [7, 10], radius: [px(60), px(54)], pause: [0.8, 0.6], speed: [px(150), px(170)], rings: [1, 1], gap: [px(30), px(26)] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        throw: { cooldown: [0.95, 0.75], damage: [10, 13], count: [6, 8], speed: [px(250), px(265)] },
        encircle: { cooldown: [2.7, 2.4], damage: [10, 13], radius: [px(54), px(48)], pause: [0.6, 0.45], speed: [px(170), px(190)], rings: [2, 2], gap: [px(26), px(22)] },
        flurry: { cooldown: [2.2, 1.8], damage: [9, 12], streams: [3, 4], count: [5, 7], stagger: [0.22, 0.16], speed: [px(200), px(230)], slashes: [1, 3], warn: [0.5, 0.35] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['throw', 'encircle', 'flurry'],
    knifeLength: px(18),
    knifeWidth: px(4),
    throwStagger: 0.07,
    // Soul diameter 18 px + 12 px of room.
    minGap: px(20),
    minPause: 0.4,
    ringSlots: 14,
    ringGapTime: 0.9,
    minWarn: 0.3,
    slashTime: 0.16,
    slashThickness: px(5),
    warnThickness: px(1.5),
    streamSpacing: px(16),
  },
};

const knives = new Map<string, CompositeForm>();
/**
 * A knife of length L and blade width w pointing along +x, centered on its length: a straight blade
 * ending in a sharp tip, a crossguard, a wrapped handle and a round pommel. Every part is solid
 * (drawn == hitbox). Spans x from -L/2 (pommel) to +L/2 (tip).
 */
export function knifeForm(L: number, w: number): CompositeForm {
  const key = `${L}:${w}`;
  let f = knives.get(key);
  if (!f) {
    const h = w / 2;
    f = makeForm([
      { kind: 'rect', x: 0.08 * L, y: 0, hw: 0.2 * L, hh: h },
      { kind: 'tri', ax: 0.28 * L, ay: -h, bx: 0.28 * L, by: h, cx: 0.5 * L, cy: 0 },
      { kind: 'rect', x: -0.14 * L, y: 0, hw: 0.025 * L, hh: h * 1.9 },
      { kind: 'rect', x: -0.29 * L, y: 0, hw: 0.13 * L, hh: h * 0.7 },
      { kind: 'circle', x: -0.45 * L, y: 0, r: h * 0.95 },
    ]);
    knives.set(key, f);
  }
  return f;
}
