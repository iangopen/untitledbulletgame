import type { World } from '../core/World';
import { mulberry32 } from '../core/rng';
import { resolveLevel, type CharacterConfig, type ResolvedAttack, type ResolvedLevel } from './config';
import type { BulletShape } from '../combat/Bullet';
import type { CompositeForm } from '../combat/composite';

/**
 * One look a character can draw at its current level, for texture prewarming (pure data; the
 * renderer rasterises each before the battle starts). `radii` lists every circle radius a growing
 * bullet passes through; `prop` = a triangle prop of that radius; `shine` = it shines when it arms.
 */
export interface LookSpec {
  shape?: BulletShape;
  a?: number;
  b?: number;
  form?: CompositeForm | null;
  radii?: number[];
  glow?: boolean;
  shine?: boolean;
  decor?: boolean;
  prop?: number;
}

/**
 * When an attack's first shot reaches the box after it becomes active (s), staggered per attack.
 * The first plan is pre-fired (see tick), so this holds even for long off-screen leads.
 */
const FIRST_SHOT_DELAY = 1.0;
const FIRST_SHOT_STAGGER = 0.6;
/** Guard against a zero cooldown planning forever in one step. */
const MAX_PLANS_PER_STEP = 16;

/**
 * One projectile (or row) of a planned attack. `lead` = seconds it needs from spawning off screen
 * until it reaches the box; `fire` spawns it (using the box as it is then).
 */
export interface Shot {
  lead: number;
  fire: () => void;
}

/** What the runner/Director needs from any character, independent of its attack/rule types. */
export interface CharacterHandle {
  readonly id: string;
  readonly color: number;
  readonly level: number;
  readonly active: boolean;
  setLevel(level: number): void;
  tick(dt: number): void;
  /** Run one attack now with the params of `level` (Debug sandbox). False if not unlocked there. */
  fireNow(id: string, level?: number): boolean;
  dispose(): void;
  /** Every bullet look this character can produce at its current level (texture prewarm). */
  lookSpecs?(): LookSpec[];
}

interface Pending {
  at: number;
  fire: () => void;
  plan: { attack: string; started: boolean };
}

/**
 * Base for all characters. Owns level, resolved config and the attack schedule,
 * driven by the fixed step. Subclasses supply one method per attack.
 * Characters never import each other; they talk through world.bus only.
 *
 * Arrival timing: each attack's timer counts down to when it should REACH the box (the beat set
 * by its cooldown). An attack either acts immediately (returns nothing) or returns Shots, each with
 * the lead time it needs to travel in from off screen; the base plans the attack `planAhead()`
 * seconds early and spawns every shot at (arrival - lead), so off-screen spawns keep the old beat.
 * If a plan's lead is longer than the time left (battle start), the arrival and the rest of that
 * attack's schedule shift later rather than bunching up. The base emits `attackStarted` when an
 * attack's first projectile spawns, so every character drives its profile box for free.
 */
export abstract class Character<A extends string = string, R = Record<string, number | boolean>> implements CharacterHandle {
  abstract readonly id: string;
  abstract readonly color: number;
  abstract readonly config: CharacterConfig<A, R>;
  /**
   * One method per attack id. Return Shots to have them timed to arrive on the beat, nothing if it
   * acted immediately, or null if it chose to do nothing this time (no attackStarted).
   */
  protected abstract readonly attacks: Record<A, (p: ResolvedAttack) => Shot[] | void | null>;

  level = 0;
  resolved: ResolvedLevel<A> = { level: 0, band: -1, attacks: {} };
  /** Seconds until each enabled attack should next arrive. */
  readonly timers: Partial<Record<A, number>> = {};
  protected readonly rng: () => number;
  /** Game seconds this character has ticked (its own clock for planned spawns). */
  protected clock = 0;
  private pending: Pending[] = [];
  /**
   * Pre-fire each attack's first plan so the opening arrives on time (its bullets may then appear
   * already on screen). Characters whose projectiles must always spawn off screen turn this off;
   * their first arrivals wait for the off-screen travel instead.
   */
  protected readonly preFireOpening: boolean = true;
  /** Attacks whose first plan has run (later plans shift instead of pre-firing). */
  private readonly planned = new Set<string>();

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

  /**
   * Upper bound on the lead any shot of this attack can need (s): how early to plan it.
   * 0 (default) = the attack runs exactly on its beat.
   */
  protected planAhead(_id: A, _p: ResolvedAttack): number {
    return 0;
  }

  /** Seconds between arrivals for an attack (default: the resolved cooldown). */
  protected cooldownOf(_id: A, p: ResolvedAttack): number {
    return p.cooldown ?? 1;
  }

  /**
   * The earliest allowed arrival (own clock, s) at or after `at` for this attack. Default: `at`.
   * Characters with phases return the start of the attack's next window when `at` falls outside one.
   */
  protected nextArrival(_id: A, at: number): number {
    return at;
  }

  /** Called every fixed step before the world steps. */
  tick(dt: number): void {
    if (!this.active) return;
    this.clock += dt;
    this.update(dt);
    this.firePending();
    for (const id of Object.keys(this.resolved.attacks) as A[]) {
      const p = this.resolved.attacks[id]!;
      let t = (this.timers[id] ?? 0) - dt;
      const ahead = Math.max(0, this.planAhead(id, p));
      for (let n = 0; t - ahead <= 0 && n < MAX_PLANS_PER_STEP; n++) {
        // Outside the attack's window: move the next arrival to where the window opens.
        const at = this.nextArrival(id, this.clock + t);
        if (at > this.clock + t + 1e-9) {
          t = at - this.clock;
          continue;
        }
        const shots = this.attacks[id](p);
        const plan = { attack: id, started: false };
        if (shots === null) {
          // Skipped this beat: nothing happened, so nothing lights up.
        } else if (!shots || shots.length === 0) {
          this.started(plan);
        } else {
          // Arrive on the beat, or as soon as the slowest shot can if the beat is too close.
          // (Only shift when a shot truly needs longer, so the sub-step remainder of t is kept.)
          const need = Math.max(...shots.map((s) => s.lead));
          if (!this.planned.has(id) && this.preFireOpening) {
            // First plan: pre-fire. A shot that needs longer than the time left spawns now,
            // already advanced along its path, so the opening arrives on its beat instead of late.
            for (const s of shots) {
              if (s.lead > t) this.preFire(s, s.lead - Math.max(0, t), plan);
              else this.pending.push({ at: this.clock + t - s.lead, fire: s.fire, plan });
            }
          } else {
            const arrive = need > 0 && need > t ? need : t;
            for (const s of shots) this.pending.push({ at: this.clock + arrive - s.lead, fire: s.fire, plan });
            t = arrive;
          }
        }
        this.planned.add(id);
        t += this.cooldownOf(id, p);
      }
      this.timers[id] = t;
    }
    this.firePending();
  }

  /**
   * Dev tool (DebugScene): run one attack right now with the params of `level` (default: the
   * current level), spawning its shots immediately instead of on the beat. False if not unlocked there.
   */
  fireNow(id: A, level = this.level): boolean {
    const p = resolveLevel(this.config, level).attacks[id];
    if (!p) return false;
    const shots = this.attacks[id](p);
    if (shots) for (const s of shots) s.fire();
    this.started({ attack: id, started: false });
    return true;
  }

  /** Spawn every planned shot whose time has come (in time order). */
  private firePending(): void {
    if (this.pending.length === 0) return;
    const due = this.pending.filter((s) => s.at <= this.clock + 1e-9).sort((a, b) => a.at - b.at);
    if (due.length === 0) return;
    this.pending = this.pending.filter((s) => s.at > this.clock + 1e-9);
    for (const s of due) {
      s.fire();
      this.started(s.plan);
    }
  }

  /** Fire a shot now with its new bullets moved `advance` seconds along their (straight) paths. */
  private preFire(s: Shot, advance: number, plan: { attack: string; started: boolean }): void {
    const pool = this.world.pool;
    const before = new Set(pool.all.filter((b) => b.active));
    s.fire();
    for (const b of pool.all) {
      if (!b.active || before.has(b)) continue;
      b.x += b.vx * advance;
      b.y += b.vy * advance;
      b.snapshot();
    }
    this.started(plan);
  }

  private started(plan: { attack: string; started: boolean }): void {
    if (plan.started) return;
    plan.started = true;
    this.world.bus.emit('attackStarted', { owner: this.id, attack: plan.attack });
  }

  /** Per-step behavior beyond scheduled attacks (props, steering). */
  protected update(_dt: number): void {}
  protected onLevelChanged(_prev: ResolvedLevel<A>): void {}
  /** Remove anything this character placed in the world. */
  dispose(): void {}
  lookSpecs(): LookSpec[] {
    return [];
  }
}
