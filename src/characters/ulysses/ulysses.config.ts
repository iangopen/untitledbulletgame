import type { CharacterConfig } from '../config';
import { px } from '../../tuning';

export type UlyssesAttack = 'summon' | 'swipe' | 'rain';

export interface UlyssesRules {
  /** Seconds each phase lasts (shines fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new shines. */
  breather: number;
  /** Phase order; one phase per unlocked attack. */
  phaseOrder: readonly UlyssesAttack[];
  /** Sword: a long thin rect (beam shape), length and thickness (px). */
  swordLength: number;
  swordWidth: number;
  /** Gap between the box wall and the nearest point of a forming sword (px). */
  formGap: number;
  /** Summon: slots along one edge where swords can form. */
  summonSlots: number;
  /** Side swipe: blade thickness (px) and seconds between two back-to-back swipes. */
  swipeThickness: number;
  swipeGap: number;
}

/**
 * Prince Ulysses (gold shield): every sword forms GOLD (pre-active: drawn, never collides) just
 * outside the box, shines and turns white, and only then hurts. Unlocked attacks alternate in
 * phases (one per attack, phaseLength s, breather between); an attack's beat is its shine time.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  summon: cooldown s, damage, speed px/s (flight), count (swords), grow s (gold time; lower = harder)
 *  swipe:  cooldown s, damage, speed px/s (sweep), coverage (share of the side), double (chance of a second swipe), windup s (gold time; lower = harder)
 *  rain:   cooldown s, damage, speed px/s (drop), count (swords), stagger s (between shines; lower = harder), windup s (gold time before the first shine), fallGap s (shine to drop; lower = harder)
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
        swipe: { cooldown: [3.0, 2.4], damage: [8, 11], speed: [px(160), px(200)], coverage: [0.45, 0.6], double: [0, 0.15], windup: [1.0, 0.9] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        summon: { cooldown: [1.1, 0.9], damage: [10, 12], speed: [px(172), px(185)], count: [3, 4], grow: [0.85, 0.7] },
        swipe: { cooldown: [2.4, 2.0], damage: [11, 14], speed: [px(200), px(230)], coverage: [0.6, 0.7], double: [0.2, 0.5], windup: [0.9, 0.8] },
        rain: { cooldown: [3.4, 2.8], damage: [10, 13], speed: [px(200), px(240)], count: [6, 9], stagger: [0.18, 0.12], windup: [1.0, 0.85], fallGap: [0.35, 0.2] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['summon', 'swipe', 'rain'],
    swordLength: px(40),
    swordWidth: px(5),
    formGap: px(10),
    summonSlots: 6,
    swipeThickness: px(10),
    swipeGap: 0.7,
  },
};

/** Bullet flags on Ulysses' projectiles (owner 'ulysses'). Combo rules read these. */
export const SWORD_FLAGS = {
  /** A thrown sword (summon or rain), as opposed to the side-swipe blade. */
  sword: 1,
  /** Internal: the rain hook has set this sword's shine order. */
  ordered: 2,
  /** Came out of a refraction prism (Prism combo); ignores prisms from now on. */
  split: 4,
} as const;
