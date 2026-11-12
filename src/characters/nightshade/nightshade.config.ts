import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm } from '../../combat/composite';

export type NightshadeAttack = 'spores' | 'miasma' | 'burst';

export interface NightshadeRules {
  /** Phases cycle through only unlocked attacks: phaseLength s each, breather between. */
  phaseLength: number;
  breather: number;
  phaseOrder: readonly NightshadeAttack[];
  /** Spore radius (px; a solid disc, exactly its hitbox) and its slow drift while it lingers (px/s). */
  sporeSize: number;
  lingerDrift: number;
  /** Miasma: width of one cloud strip (px); a cloud is strips laid side by side from a wall inward. */
  stripWidth: number;
  /** Miasma: each strip shows gold (pre-active, harmless) this long before it turns to poison (s). */
  stripForm: number;
  /** Miasma: at least this fraction of the box (along the cloud's depth) always stays clear. */
  minClear: number;
  /** Burst: pods form (pre-active, harmless) for at least this long (s), at any level. */
  minForm: number;
  /** Burst: pod radius (px), and the least distance from the soul a pod forms at (px). */
  podSize: number;
  podClear: number;
  /** Visual-only alpha shimmer of spores and clouds (never touches the hitbox). */
  shimmer: number;
}

/**
 * Nightshade (a nightshade berry, deep violet; roster and profile only). Every projectile is KR
 * (magenta): a KR hit fills the KR pool (it drains into HP but never below 1), so she cannot kill
 * the soul on her own. That is intentional.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  spores: cooldown s, damage (KR), count (spores per drift), speed px/s (drifting in), linger s (in the box)
 *  miasma: cooldown s, damage (KR), strips (cloud depth, in strips; capped by rules.minClear), spread s
 *          (between strips; lower = faster), hold s (full cloud)
 *  burst:  cooldown s, damage (KR), count (pods), ring (spores per ring), form s (forming; never below
 *          rules.minForm), speed px/s (ring)
 */
export const nightshadeConfig: CharacterConfig<NightshadeAttack, NightshadeRules> = {
  id: 'nightshade',
  title: 'Nightshade',
  description: 'Beautiful. Poisonous. Patient.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        spores: { cooldown: [1.6, 1.3], damage: [3, 4], count: [3, 4], speed: [px(90), px(95)], linger: [2.0, 2.6] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        spores: { cooldown: [1.3, 1.0], damage: [4, 6], count: [4, 6], speed: [px(95), px(105)], linger: [2.6, 3.4] },
        miasma: { cooldown: [5.0, 4.2], damage: [4, 6], strips: [4, 6], spread: [0.45, 0.35], hold: [1.2, 1.8] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        spores: { cooldown: [1.0, 0.85], damage: [6, 8], count: [6, 7], speed: [px(105), px(110)], linger: [3.4, 4.0] },
        miasma: { cooldown: [4.2, 3.6], damage: [6, 8], strips: [6, 7], spread: [0.35, 0.28], hold: [1.8, 2.4] },
        burst: { cooldown: [2.6, 2.0], damage: [6, 8], count: [2, 4], ring: [10, 16], form: [0.8, 0.5], speed: [px(110), px(130)] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['spores', 'miasma', 'burst'],
    sporeSize: px(6),
    lingerDrift: px(6),
    stripWidth: px(20),
    stripForm: 0.35,
    minClear: 0.4,
    minForm: 0.4,
    podSize: px(9),
    podClear: px(45),
    shimmer: 0.25,
  },
};

const pods = new Map<number, CompositeForm>();
/**
 * A spore pod of radius R (pre-active only, so it never collides): a round berry with a five-point
 * calyx on top. Drawn from the same parts as any composite.
 */
export function podForm(R: number): CompositeForm {
  let f = pods.get(R);
  if (!f) {
    f = makeForm([
      { kind: 'circle', x: 0, y: R * 0.15, r: R * 0.85 },
      { kind: 'tri', ax: -R * 0.55, ay: -R * 0.45, bx: 0, by: -R * 0.6, cx: -R * 0.35, cy: -R },
      { kind: 'tri', ax: R * 0.55, ay: -R * 0.45, bx: 0, by: -R * 0.6, cx: R * 0.35, cy: -R },
      { kind: 'tri', ax: -R * 0.2, ay: -R * 0.6, bx: R * 0.2, by: -R * 0.6, cx: 0, cy: -R * 1.05 },
    ]);
    pods.set(R, f);
  }
  return f;
}
