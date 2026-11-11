import type { World } from '../core/World';
import { mulberry32 } from '../core/rng';
import { resolveLevel, type CharacterConfig, type ResolvedAttack, type ResolvedLevel } from './config';

/** Delay before an attack's first shot after it becomes active (s), staggered per attack. */
const FIRST_SHOT_DELAY = 0.8;
const FIRST_SHOT_STAGGER = 0.6;

/** What the runner/Director needs from any character, independent of its attack/rule types. */
export interface CharacterHandle {
  readonly id: string;
  readonly color: number;
  readonly level: number;
  readonly active: boolean;
  setLevel(level: number): void;
  tick(dt: number): void;
  dispose(): void;
}

/**
 * Base for all characters. Owns level, resolved config and the attack schedule,
 * driven by the fixed step. Subclasses supply one method per attack.
 * Characters never import each other; they talk through world.bus only.
 */
export abstract class Character<A extends string = string, R = Record<string, number | boolean>> implements CharacterHandle {
  abstract readonly id: string;
  abstract readonly color: number;
  abstract readonly config: CharacterConfig<A, R>;
  /** One method per attack id, called when its cooldown elapses. */
  protected abstract readonly attacks: Record<A, (p: ResolvedAttack) => void>;

  level = 0;
  resolved: ResolvedLevel<A> = { level: 0, band: -1, attacks: {} };
  /** Seconds until each enabled attack fires next. */
  readonly timers: Partial<Record<A, number>> = {};
  protected readonly rng: () => number;

  constructor(
    protected readonly world: World,
    seed = 1,
  ) {
    this.rng = mulberry32(seed);
  }

  get active(): boolean {
    return this.level > 0;
  }

  setLevel(level: number): void {
    const prev = this.resolved;
    this.resolved = resolveLevel(this.config, level);
    this.level = this.resolved.level;
    let i = 0;
    for (const id of Object.keys(this.attacks) as A[]) {
      const enabled = id in this.resolved.attacks;
      if (!enabled) delete this.timers[id];
      else if (!(id in prev.attacks) || this.timers[id] === undefined) this.timers[id] = FIRST_SHOT_DELAY + FIRST_SHOT_STAGGER * i++;
    }
    this.onLevelChanged(prev);
  }

  /** Called every fixed step before the world steps. */
  tick(dt: number): void {
    if (!this.active) return;
    this.update(dt);
    for (const id of Object.keys(this.resolved.attacks) as A[]) {
      const p = this.resolved.attacks[id]!;
      let t = (this.timers[id] ?? 0) - dt;
      if (t <= 0) {
        this.attacks[id](p);
        t += p.cooldown ?? 1;
      }
      this.timers[id] = t;
    }
  }

  /** Per-step behavior beyond scheduled attacks (props, steering). */
  protected update(_dt: number): void {}
  protected onLevelChanged(_prev: ResolvedLevel<A>): void {}
  /** Remove anything this character placed in the world. */
  dispose(): void {}
}
