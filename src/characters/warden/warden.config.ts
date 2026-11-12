import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm } from '../../combat/composite';

export type WardenAttack = 'punch' | 'spin';

export interface WardenRules {
  /** Seconds each phase lasts (every punch, return and spin finishes inside it). */
  phaseLength: number;
  /** Seconds between phases with nothing new. */
  breather: number;
  /** Phase order; one phase per unlocked attack (L1-5: punch, breather, punch ...). */
  phaseOrder: readonly WardenAttack[];
  /** Fist: gap to the wall when it starts forming (px), how far it draws back during the wind-up (px), lunge time to the wall (s). */
  fistGap: number;
  fistPull: number;
  lungeTime: number;
  /** Seconds the box takes to slide after a punch (shove and return). */
  shoveTime: number;
  /** Seconds a fist lingers against the wall after the shove before it is gone. */
  fistLinger: number;
  /** Clearance kept between the box (or a fist) and the screen edge / HUD bands (px). */
  margin: number;
  /** Below this fraction of the wanted shove, the other direction is used instead. */
  minShoveFraction: number;
  /** Spin: largest swing angle (rad), further limited so the turned box stays clear of the HUD bands; seconds to turn back to 0 at the end. */
  spinMaxAngle: number;
  spinReturn: number;
}

/**
 * The Warden (orange stone golem): a PURE SUPPORT character. His fists are objects, not
 * projectiles: they never collide and never enter the box (decor bullets). His danger is moving
 * the box into other characters' attacks, which stay world-fixed while the box moves. Alone he
 * deals zero damage.
 * Params per attack (all [bandStart, bandEnd]); distances are px(original 640x480 value):
 *  punch: cooldown s (impact to impact), windup s (fist forming and drawing back; lower = harder),
 *         distance px (shove length, clamped to the room on screen), back s (impact to the return
 *         punch; lower = harder), vertical (chance a punch is vertical)
 *  spin:  cooldown s, speed rad/s (swing speed), duration s (how long the spin lasts), reverse
 *         (chance a swing turns back early)
 */
export const wardenConfig: CharacterConfig<WardenAttack, WardenRules> = {
  id: 'warden',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        punch: { cooldown: [3.4, 3.0], windup: [0.9, 0.75], distance: [px(80), px(110)], back: [1.6, 1.3], vertical: [0, 0] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        punch: { cooldown: [3.0, 2.3], windup: [0.75, 0.55], distance: [px(110), px(170)], back: [1.3, 0.9], vertical: [0.1, 0.3] },
        spin: { cooldown: [4.0, 3.6], speed: [1.2, 1.8], duration: [1.4, 2.2], reverse: [0, 0.3] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        punch: { cooldown: [2.2, 1.6], windup: [0.55, 0.4], distance: [px(170), px(230)], back: [0.9, 0.6], vertical: [0.3, 0.5] },
        spin: { cooldown: [3.6, 3.6], speed: [1.8, 2.6], duration: [2.2, 3.0], reverse: [0.3, 0.5] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['punch', 'spin'],
    fistGap: px(3),
    fistPull: px(8),
    lungeTime: 0.08,
    shoveTime: 0.32,
    fistLinger: 0.12,
    margin: px(2),
    minShoveFraction: 0.35,
    spinMaxAngle: 0.6,
    spinReturn: 0.4,
  },
};

/**
 * A chunky rocky fist, pointing +x (toward the box), origin at the front of the knuckles (x <= 0):
 * four knuckle blocks, a palm block, a thumb, a wrist and a rock chip. Separate blocks with small
 * gaps and an outlined edge, so it reads as a solid object. Never collides (decor).
 */
export const FIST_FORM: CompositeForm = makeForm([
  { kind: 'rect', x: -27, y: 0, hw: 13, hh: 20 }, // palm
  { kind: 'rect', x: -6.5, y: -15.3, hw: 6.5, hh: 4.6 }, // knuckles
  { kind: 'rect', x: -6.5, y: -5.1, hw: 6.5, hh: 4.6 },
  { kind: 'rect', x: -6.5, y: 5.1, hw: 6.5, hh: 4.6 },
  { kind: 'rect', x: -6.5, y: 15.3, hw: 6.5, hh: 4.6 },
  { kind: 'rect', x: -20, y: 23, hw: 7, hh: 4, rot: -0.3 }, // thumb
  { kind: 'rect', x: -44, y: 0, hw: 4.5, hh: 13 }, // wrist
  { kind: 'tri', ax: -38, ay: -20, bx: -24, by: -20, cx: -33, cy: -26 }, // rock chip
]);
/** Fist depth from the knuckles' front to the back of the wrist (px). */
export const FIST_DEPTH = 48.5;
