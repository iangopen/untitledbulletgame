import type { World } from '../../core/World';
import { AFTERGLOW_IFRAMES, QUICK_CHARGE_COOLDOWN, STEADY_SLOW_MULTIPLIER, THICK_SKIN_HP } from '../../tuning';

/**
 * A passive ability: always on, applied ONCE at battle start (after the active is equipped) through
 * `equipLoadout`. A new passive is one entry in PASSIVES; the battle code never changes.
 */
export interface Passive {
  readonly id: string;
  readonly name: string;
  apply(world: World): void;
}

export const PASSIVE_LIST: readonly Passive[] = [
  {
    id: 'thickSkin',
    name: 'thick skin',
    apply: (w) => {
      w.soul.maxHp = Math.round(w.soul.maxHp * THICK_SKIN_HP);
      w.soul.hp = w.soul.maxHp;
    },
  },
  { id: 'afterglow', name: 'afterglow', apply: (w) => void (w.soul.iframeDuration = AFTERGLOW_IFRAMES) },
  { id: 'quickCharge', name: 'quick charge', apply: (w) => void (w.ability && (w.ability.cooldownScale = QUICK_CHARGE_COOLDOWN)) },
  { id: 'steady', name: 'steady', apply: (w) => void (w.soul.slowMultiplier = STEADY_SLOW_MULTIPLIER) },
];
