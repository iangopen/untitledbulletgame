import type { CharacterConfig } from '../config';
import { px } from '../../tuning';
import { makeForm, type CompositeForm, type Part } from '../../combat/composite';

export type VoltAttack = 'strike' | 'fork' | 'storm';

export interface VoltRules {
  /** Seconds each phase lasts and the breather between; phases cycle through only unlocked attacks. */
  phaseLength: number;
  breather: number;
  phaseOrder: readonly VoltAttack[];
  /** No warning (strike column, branch flash, storm column) is ever shorter than this (s), at any level. */
  minWarn: number;
  /** Seconds a bolt collides once it has struck (then it fades). */
  boltTime: number;
  /** How fast a bolt drops from above the screen (px/s): a strike, not a projectile you dodge on the way. */
  boltSpeed: number;
  /** Bolt solid core thickness (px), how far the jags swing either side of the bolt's line (px), zigzag pieces per bolt. */
  boltCore: number;
  boltJag: number;
  boltPieces: number;
  /** Strike bolt length (px): long enough that it starts fully above the screen and still reaches the box's bottom wall. */
  boltLength: number;
  /** Fork branch length (px): from the strike line across the box and out past a wall. */
  branchLength: number;
  /** Jag shape variants per length (all prewarmed; each variant's hitbox is its own drawn shape). */
  variants: number;
  /** Storm: the narrowest a safe column may ever be (px, the free space between neighbouring bolt columns); above the soul's 18 px. */
  stormSafeMin: number;
  /** Storm: safe columns per wave (one of them always within reach of the last wave's). */
  stormSafeCount: number;
}

/**
 * Volt (lightning bolt, electric violet; roster and profile only). Every projectile is white.
 * Every attack is a warning, then a strike: warnings are pre-active (drawn gold, harmless) and each
 * bolt collides only while it strikes (boltTime), then fades. No warning is ever below rules.minWarn.
 * Params per attack (all [bandStart, bandEnd]); distances are px(original 640x480 value):
 *  strike: cooldown s, damage, count (columns struck at once), warn s, burst (strikes in a quick
 *          sequence), gap s (between strikes of a sequence; lower = quicker)
 *  fork:   cooldown s, damage, warn s (the column), branches (per strike), flash s (branch warning),
 *          stagger s (between branches; lower = faster branching)
 *  storm:  cooldown s, damage, waves (per storm), warn s, interval s (between waves), safe px (safe
 *          column width; never below rules.stormSafeMin)
 */
export const voltConfig: CharacterConfig<VoltAttack, VoltRules> = {
  id: 'volt',
  title: 'Volt',
  description: 'He never strikes the same place twice. He doesn’t need to.',
  maxLevel: 20,
  bands: [
    {
      from: 1,
      to: 5,
      attacks: {
        strike: { cooldown: [2.2, 1.8], damage: [5, 7], count: [1, 2], warn: [0.75, 0.65], burst: [1, 1], gap: [0.5, 0.5] },
      },
    },
    {
      from: 6,
      to: 14,
      attacks: {
        strike: { cooldown: [1.8, 1.4], damage: [7, 10], count: [2, 3], warn: [0.65, 0.5], burst: [1, 2], gap: [0.5, 0.42] },
        fork: { cooldown: [2.4, 1.9], damage: [7, 10], warn: [0.65, 0.5], branches: [1, 2], flash: [0.5, 0.42], stagger: [0.3, 0.22] },
      },
    },
    {
      from: 15,
      to: 20,
      attacks: {
        strike: { cooldown: [1.4, 1.1], damage: [10, 13], count: [3, 4], warn: [0.5, 0.4], burst: [2, 3], gap: [0.42, 0.35] },
        fork: { cooldown: [1.9, 1.5], damage: [10, 13], warn: [0.5, 0.4], branches: [2, 3], flash: [0.42, 0.34], stagger: [0.22, 0.15] },
        storm: { cooldown: [4.5, 3.8], damage: [9, 12], waves: [3, 5], warn: [0.45, 0.32], interval: [0.85, 0.65], safe: [px(32), px(22)] },
      },
    },
  ],
  rules: {
    phaseLength: 8,
    breather: 1,
    phaseOrder: ['strike', 'fork', 'storm'],
    minWarn: 0.3,
    boltTime: 0.22,
    boltSpeed: px(4000),
    boltCore: px(3),
    boltJag: px(5),
    boltPieces: 14,
    boltLength: px(440),
    branchLength: px(300),
    variants: 4,
    // Soul diameter 18 px + 9 px.
    stormSafeMin: px(18),
    stormSafeCount: 2,
  },
};

/**
 * Full width of a bolt's column (the strip its hitbox stays inside): the swing both ways plus, at a
 * corner, a piece's end cap (up to core x sqrt(2) / 2 off the line).
 */
export function columnWidth(r: VoltRules): number {
  return 2 * (r.boltJag + r.boltCore * Math.SQRT1_2);
}

const bolts = new Map<string, CompositeForm>();
/**
 * A jagged bolt along +x from the origin to `length`: a zigzag through `pieces` points that swing up
 * to `jag` either side of the line (variant `v` picks a fixed pseudo-random swing pattern), drawn and
 * collided as a chain of solid rects of thickness `core`, the last one ending in a point at the far end.
 * Every variant stays inside the column of width 2 jag + core, so the warning column covers it exactly.
 */
export function boltForm(length: number, core: number, jag: number, pieces: number, v: number): CompositeForm {
  const key = `${length}:${core}:${jag}:${pieces}:${v}`;
  let f = bolts.get(key);
  if (f) return f;
  let seed = 9301 * (v + 1);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts: [number, number][] = [[0, 0]];
  for (let i = 1; i < pieces; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    pts.push([(length * (i + (rnd() - 0.5) * 0.5)) / pieces, side * jag * (0.45 + 0.55 * rnd())]);
  }
  pts.push([length, 0]);
  const parts: Part[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    // Each piece reaches core/2 past its ends along its own direction, so neighbours meet; the
    // swing (<= jag) plus core/2 keeps every corner inside the column.
    parts.push({ kind: 'rect', x: (ax + bx) / 2, y: (ay + by) / 2, hw: len / 2 + core / 2, hh: core / 2, rot: Math.atan2(by - ay, bx - ax) });
  }
  f = makeForm(parts);
  bolts.set(key, f);
  return f;
}
