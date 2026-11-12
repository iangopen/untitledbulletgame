import type { CharacterConfig } from '../config';
import { px, SOUL_RADIUS } from '../../tuning';
import { makeForm, type CompositeForm } from '../../combat/composite';

export type UlyssesAttack = 'summon' | 'axe' | 'rain';

export interface UlyssesRules {
  /** Seconds each phase lasts (shines fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new shines. */
  breather: number;
  /** Phase order; one phase per unlocked attack. */
  phaseOrder: readonly UlyssesAttack[];
  /** Sword: overall length (px, pommel to tip) and crossguard half-width (its widest part). */
  swordLength: number;
  swordWidth: number;
  /** Gap between the box wall and the nearest point of a forming sword (px). */
  formGap: number;
  /** Summon: slots along one edge where swords can form. */
  summonSlots: number;
  /** Axe: how far past the wall it rests before the swing (rad), seconds between two back-to-back swings. */
  axeRest: number;
  axeGap: number;
  /** Sword rain: guaranteed clear opening in every row (px), wider than the soul's diameter. */
  rainGap: number;
}

/**
 * Prince Ulysses (gold shield): every sword forms GOLD (pre-active: drawn, never collides) just
 * outside the box, shines and turns white, and only then hurts. Unlocked attacks alternate in
 * phases (one per attack, phaseLength s, breather between); an attack's beat is its shine time.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  summon: cooldown s, damage, speed px/s (flight), count (swords), grow s (gold time; lower = harder)
 *  axe:    cooldown s, damage, speed rad/s (swing), arc rad (swing angle), reach px (pivot to axe head), double (chance of a second corner), windup s (gold time; lower = harder)
 *  rain:   cooldown s, damage, speed px/s (drop), count (swords), jitter s (spread of the shines; lower = harder), windup s (gold time), fallGap s (shine to drop; lower = harder)
 */
export const ulyssesConfig: CharacterConfig<UlyssesAttack, UlyssesRules> = {
  id: 'ulysses',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        summon: { cooldown: [1.7, 1.4], damage: [5, 7], speed: [px(150), px(158)], count: [1, 2], grow: [1.1, 1.0] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        summon: { cooldown: [1.4, 1.1], damage: [7, 10], speed: [px(158), px(172)], count: [2, 3], grow: [1.0, 0.85] },
        axe: { cooldown: [3.0, 2.4], damage: [8, 11], speed: [2.6, 3.2], arc: [1.1, 1.3], reach: [px(110), px(125)], double: [0, 0.15], windup: [1.0, 0.9] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        summon: { cooldown: [1.1, 0.9], damage: [10, 12], speed: [px(172), px(185)], count: [3, 4], grow: [0.85, 0.7] },
        axe: { cooldown: [2.4, 2.0], damage: [11, 14], speed: [3.2, 4.0], arc: [1.3, 1.55], reach: [px(125), px(140)], double: [0.2, 0.5], windup: [0.9, 0.8] },
        rain: { cooldown: [3.4, 2.8], damage: [10, 13], speed: [px(200), px(240)], count: [18, 27], jitter: [0.12, 0.08], windup: [1.0, 0.85], fallGap: [0.35, 0.2] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['summon', 'axe', 'rain'],
    swordLength: px(40),
    swordWidth: px(16 / 3),
    formGap: px(10),
    summonSlots: 6,
    axeRest: 0.32,
    axeGap: 0.7,
    rainGap: SOUL_RADIUS * 2 + px(5),
  },
};

/** Bullet flags on Ulysses' projectiles (owner 'ulysses'). Combo rules read these. */
export const SWORD_FLAGS = {
  /** A thrown sword (summon or rain), as opposed to the axe. */
  sword: 1,
  /** Internal: the rain hook has set this sword's shine order. */
  ordered: 2,
  /** Came out of a refraction prism (Prism combo); ignores prisms from now on. */
  split: 4,
} as const;

/**
 * Sword (pointing +x, origin at its middle, 60 px long): blade, tip, crossguard, grip, pommel.
 * Drawn and collided from these parts (combat/composite.ts).
 */
export const SWORD_FORM: CompositeForm = makeForm([
  { kind: 'rect', x: 7, y: 0, hw: 17, hh: 2.5 }, // blade
  { kind: 'tri', ax: 24, ay: -2.5, bx: 24, by: 2.5, cx: 30, cy: 0 }, // tip
  { kind: 'rect', x: -11, y: 0, hw: 1.5, hh: 8 }, // crossguard
  { kind: 'rect', x: -19.25, y: 0, hw: 6.75, hh: 1.75 }, // grip
  { kind: 'circle', x: -27.5, y: 0, r: 2.5 }, // pommel
]);

const axeForms = new Map<string, CompositeForm>();
/**
 * Axe (origin = the pivot at the box corner, handle along +x out to `reach`), with its blade on
 * side `side` (+1 = local +y, the leading side when it swings toward increasing angle).
 */
export function axeForm(reach: number, side: 1 | -1): CompositeForm {
  const key = `${reach.toFixed(2)}:${side}`;
  let f = axeForms.get(key);
  if (!f) {
    const R = reach;
    // A broad head: about 44 px along the handle (it was 18), so the head reads clearly against
    // the long handle at full reach. Parts are its exact hitbox.
    f = makeForm([
      { kind: 'rect', x: (R - 16) / 2, y: 0, hw: (R - 44) / 2, hh: 3 }, // handle (from 14 px out, into the head)
      { kind: 'rect', x: R - 22, y: side * 11, hw: 16, hh: 11 }, // head block
      { kind: 'tri', ax: R - 38, ay: side * 2, bx: R - 38, by: side * 22, cx: R - 46, cy: side * 26 }, // rear flare
      { kind: 'tri', ax: R - 6, ay: side * 2, bx: R - 6, by: side * 22, cx: R + 2, cy: side * 26 }, // front flare
      { kind: 'rect', x: R - 22, y: side * 24, hw: 24, hh: 2 }, // cutting edge (full width)
      { kind: 'tri', ax: R - 46, ay: side * 26, bx: R + 2, by: side * 26, cx: R - 22, cy: side * 31 }, // edge belly
      { kind: 'tri', ax: R - 28, ay: -side * 3, bx: R - 16, by: -side * 3, cx: R - 22, cy: -side * 11 }, // back spike
    ]);
    axeForms.set(key, f);
  }
  return f;
}
