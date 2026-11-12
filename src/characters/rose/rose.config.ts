import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm, type Part } from '../../combat/composite';

export type RoseAttack = 'volley' | 'vine' | 'bloom';
/** Rose's phases are her attacks (one phase per unlocked attack). */
export type RosePhase = RoseAttack;

export interface RoseRules {
  /** Seconds each phase lasts (arrivals at the box fall inside it). */
  phaseLength: number;
  /** Seconds between phases with no new arrivals. */
  breather: number;
  /** Volley cooldowns are divided by this inside the volley phase (the old Prism wall phase rate). */
  phaseIntensity: number;
  /**
   * Phase order. Each attack is its own phase and only unlocked attacks take part (like Mortimer),
   * so there is never an empty phase: L1-5 volley, volley, ...; L6-14 volley, vine; L15-20 volley, vine, bloom.
   */
  phaseOrder: readonly RoseAttack[];
  /** Thorn circumradius (px) and the constant distance between neighbouring volley thorns (px). */
  volleySize: number;
  volleySpacing: number;
  /** Vine lash: stem thickness, thorn length and spacing along the stem (px), vine length (px). */
  vineThickness: number;
  vineThorn: number;
  vineThornPitch: number;
  vineLength: number;
  /** Vine lash: the narrowest opening between vines (or a vine and a wall) never goes below this (px). */
  vineMinGap: number;
  /** Vine lash: vines pull back out this many times faster than they grow in. */
  vineRetract: number;
  /** Vine lash: seconds of clear box between one lash leaving and the next arriving (lashes never overlap). */
  vineClear: number;
  /** Bloom: rose radius (px), distance from the wall to the rose's edge (px), seconds it blooms (gold) before bursting. */
  roseSize: number;
  bloomGap: number;
  bloomTime: number;
}

/**
 * Rose (a rose, deep rose pink accent for roster and profile only): every projectile is white.
 * Params per attack (all [bandStart, bandEnd]); distances/speeds are px(original 640x480 value):
 *  volley: cooldown s, damage, speed px/s, gapSize (empty slots in the one safe gap). Exactly the old
 *          Prism edge volleys (same numbers), drawn as thorns.
 *  vine:   cooldown s, damage, speed px/s (how fast a vine grows across), count (vines per lash),
 *          gap px (the narrowest opening; never below rules.vineMinGap), hold s (how long it stays across).
 *          The cooldown never goes below the time one lash occupies the box (Rose.vineOccupancy), so
 *          lashes never cross each other and the gaps always stay open.
 *  bloom:  cooldown s, damage, speed px/s (thorns), count (roses per bloom), ring (thorns per rose)
 */
export const roseConfig: CharacterConfig<RoseAttack, RoseRules> = {
  id: 'rose',
  title: 'Rose',
  description: 'Every rose has its thorns. She has several thousand.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        volley: { cooldown: [2.6, 1.8], damage: [4, 6], speed: [px(70), px(95)], gapSize: [5, 3] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        volley: { cooldown: [1.75, 1.3], damage: [6, 9], speed: [px(95), px(125)], gapSize: [3, 2] },
        vine: { cooldown: [3.4, 2.9], damage: [6, 9], speed: [px(200), px(250)], count: [3, 4], gap: [px(34), px(26)], hold: [0.6, 0.8] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        volley: { cooldown: [1.25, 1.0], damage: [9, 12], speed: [px(125), px(145)], gapSize: [2, 2] },
        vine: { cooldown: [2.9, 2.7], damage: [9, 12], speed: [px(250), px(290)], count: [4, 6], gap: [px(26), px(18)], hold: [0.8, 1.0] },
        bloom: { cooldown: [3.0, 2.4], damage: [8, 10], speed: [px(90), px(115)], count: [1, 3], ring: [12, 18] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseIntensity: 2,
    phaseOrder: ['volley', 'vine', 'bloom'],
    volleySize: px(6),
    volleySpacing: px(22),
    vineThickness: px(4),
    vineThorn: px(3),
    vineThornPitch: px(16),
    vineLength: px(660),
    // Soul diameter 18 px + 9 px of room.
    vineMinGap: px(18),
    vineRetract: 2.5,
    vineClear: 0.25,
    roseSize: px(9),
    bloomGap: px(16),
    bloomTime: 0.75,
  },
};

const thorns = new Map<number, CompositeForm>();
/**
 * A rose thorn of circumradius R pointing along +x: a broad curved spike (a long triangle with a
 * hooked back edge) on a short stem stub. Drawn and collided from the same parts.
 */
export function thornForm(R: number): CompositeForm {
  let f = thorns.get(R);
  if (f) return f;
  f = makeForm([
    { kind: 'tri', ax: -R * 0.45, ay: -R * 0.55, bx: -R * 0.45, by: R * 0.55, cx: R, cy: 0 },
    // The hook: a smaller spike swept back on one side, so it reads as a thorn, not an arrowhead.
    { kind: 'tri', ax: -R * 0.45, ay: -R * 0.55, bx: R * 0.05, by: -R * 0.2, cx: -R * 0.85, cy: -R * 0.85 },
    { kind: 'rect', x: -R * 0.7, y: 0, hw: R * 0.28, hh: R * 0.22 },
  ]);
  thorns.set(R, f);
  return f;
}

const vines = new Map<string, CompositeForm>();
/**
 * A thorny vine pointing along +x with its tip at the origin and its stem trailing `length` behind:
 * a stem rect, a pointed tip and thorns every `pitch` on alternating sides, raked back toward the
 * stem's base like a rose's. Every part is solid (drawn == hitbox).
 */
export function vineForm(length: number, thickness: number, thorn: number, pitch: number): CompositeForm {
  const key = `${length}:${thickness}:${thorn}:${pitch}`;
  let f = vines.get(key);
  if (f) return f;
  const h = thickness / 2;
  const parts: Part[] = [
    { kind: 'rect', x: -length / 2, y: 0, hw: length / 2, hh: h },
    { kind: 'tri', ax: 0, ay: -h, bx: 0, by: h, cx: thickness * 1.8, cy: 0 },
  ];
  let side = 1;
  for (let x = -pitch * 0.6; x > -length + pitch * 0.5; x -= pitch) {
    const base = thorn * 0.9;
    parts.push({ kind: 'tri', ax: x - base / 2, ay: side * h, bx: x + base / 2, by: side * h, cx: x - base * 0.6, cy: side * (h + thorn) });
    side = -side;
  }
  f = makeForm(parts);
  vines.set(key, f);
  return f;
}

const roses = new Map<number, CompositeForm>();
/** A rose seen from above, radius R: a heart of overlapping petals (circles) with five outer petals. Decor only. */
export function roseForm(R: number): CompositeForm {
  let f = roses.get(R);
  if (f) return f;
  const parts: Part[] = [{ kind: 'circle', x: 0, y: 0, r: R * 0.42 }];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    parts.push({ kind: 'circle', x: Math.cos(a) * R * 0.58, y: Math.sin(a) * R * 0.58, r: R * 0.42 });
  }
  f = makeForm(parts);
  roses.set(R, f);
  return f;
}

/** Full width of a vine across its stem, thorns included (px). */
export function vineWidth(rules: RoseRules): number {
  return rules.vineThickness + 2 * rules.vineThorn;
}
