import { Character, type Shot } from '../Character';
import type { ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import { bulletExtent, type Bullet, type StepHook, type Wall } from '../../combat/Bullet';
import { line, lineOffset, lineSlots, type BulletStyle } from '../../combat/patterns';
import { maxOffscreenDistance } from '../../combat/offscreen';
import { curvedStreak, makeForm, type CompositeForm } from '../../combat/composite';
import { theme } from '../../render/theme';
import { mortimerConfig, snowflakeForm, type MortimerAttack, type MortimerRules } from './mortimer.config';
import type { LookSpec } from '../Character';

export type MortimerPhaseState = PhaseState<MortimerAttack>;

/**
 * Mortimer G. Frostwick Jr.: support character, every projectile blue (see mortimer.config.ts).
 * All attacks are rows from the `line` pattern that start off screen and travel in; per-bullet
 * motion (sway, growth) lives in onStep hooks.
 */
export class Mortimer extends Character<MortimerAttack, MortimerRules> {
  readonly id = 'mortimer';
  readonly color = theme.mortimer;
  readonly config = mortimerConfig;
  protected readonly attacks = {
    snowfall: (p: ResolvedAttack) => this.planSnowfall(p),
    roll: (p: ResolvedAttack) => this.planRoll(p),
    blizzard: (p: ResolvedAttack) => this.planBlizzard(p),
  };
  /** Every Mortimer projectile spawns off screen, so the opening waits for the travel time. */
  protected override readonly preFireOpening = false;
  /** Phase as of the last step ('' until the first tick). */
  phase: MortimerAttack | 'breather' | '' = '';

  private get rules(): MortimerRules {
    return this.config.rules;
  }

  /** Unlocked attacks in phase order (one phase each). */
  get order(): readonly MortimerAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): MortimerPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  /** Arrivals only inside the attack's own phase; a gust's later waves must also land inside it. */
  protected override nextArrival(id: MortimerAttack, at: number): number {
    const p = this.resolved.attacks.blizzard;
    const tail = id === 'blizzard' && p ? (p.count! - 1) * this.rules.gustWaveGap : 0;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: MortimerAttack, p: ResolvedAttack): number {
    return maxOffscreenDistance(this.world.box, bulletExtent(this.style(id, p))) / p.speed!;
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('mortimerPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** Bullet style per attack. Every projectile is blue. */
  private style(id: MortimerAttack, p: ResolvedAttack): BulletStyle {
    const base = { damage: p.damage!, owner: this.id, kind: 'blue' as const, noPop: true };
    // A six-armed snowflake (composite; drawn == hitbox) turning slowly as it drifts.
    if (id === 'snowfall') return { ...base, shape: 'composite', form: snowflakeForm(this.rules.flakeSize), a: 0, spin: this.rules.flakeSpin, onStep: this.swayHook(p.sway!) };
    if (id === 'roll') return { ...base, shape: 'circle', a: p.size!, onStep: this.growHook(p.growth!) };
    // A wind gust: a thin curved streak (composite of short pieces along the curve; drawn == hitbox).
    return { ...base, shape: 'composite', form: this.gustForm(p.length!), a: 0, faceVelocity: true };
  }

  /** Every look at this level: flakes, gusts, and each circle size a growing snowball passes through. */
  override lookSpecs(): LookSpec[] {
    const out: LookSpec[] = [];
    const at = this.resolved.attacks;
    if (at.snowfall) out.push({ shape: 'composite', form: snowflakeForm(this.rules.flakeSize) });
    if (at.blizzard) out.push({ shape: 'composite', form: this.gustForm(at.blizzard.length!) });
    if (at.roll) {
      // Growth until it is gone: at most the far-cull distance at its speed.
      const p = at.roll;
      const maxR = p.size! + p.growth! * (2400 / p.speed!);
      const radii: number[] = [];
      for (let r = p.size!; r <= maxR * 1.16; r *= 1.05) radii.push(r);
      out.push({ shape: 'circle', radii });
    }
    return out;
  }

  private readonly gustForms = new Map<number, CompositeForm>();
  private gustForm(length: number): CompositeForm {
    let f = this.gustForms.get(length);
    if (!f) {
      const r = this.rules;
      f = makeForm(curvedStreak(length, r.gustThickness, r.gustBend, r.gustSegments));
      this.gustForms.set(length, f);
    }
    return f;
  }

  /** `count` filled slots out of `slots`, at random; the rest are gaps. */
  private gapsFor(slots: number, count: number): number[] {
    const idx = Array.from({ length: slots }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    return idx.slice(Math.min(count, slots));
  }

  // --- Snowfall: flakes drift down from above the screen with a gentle sway ---
  private planSnowfall(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const style = this.style('snowfall', p);
    const opts = { edge: 'top' as const, spacing: this.rules.flakeSpacing, speed: p.speed!, style };
    const gaps = this.gapsFor(lineSlots(box, opts), p.count!);
    return [{ lead: lineOffset(box, opts) / p.speed!, fire: () => void line(pool, this.world.box, { ...opts, gaps }) }];
  }

  /**
   * Sideways sway x(t) = amp * sin(freq * t + phase). On its first step each flake picks its own
   * phase (stored in `flags`) and a speed up to flakeSpeedSpread faster, moving back by the same
   * factor so it still reaches the box on the beat; a row breaks up into loose snow, and every
   * flake stays off screen (it only ever moves further away).
   */
  private swayHook(amp: number): StepHook {
    const { swayFreq: w, flakeSpeedSpread: spread } = this.rules;
    return (b: Bullet) => {
      if (b.flags === 0) {
        b.flags = 1 + Math.floor(this.rng() * 1e6);
        const f = 1 + this.rng() * spread;
        const top = -this.world.box.halfHeight;
        b.y = top - (top - b.y) * f;
        b.vy *= f;
        b.snapshot();
      }
      b.vx = amp * w * Math.cos(w * b.age + b.flags);
    };
  }

  // --- Snowball roll: big balls roll in from the sides and grow as they travel ---
  private planRoll(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const edge = this.nextSide();
    const opts = { edge, count: this.rules.rollLanes, speed: p.speed!, style: this.style('roll', p) };
    const gaps = this.gapsFor(this.rules.rollLanes, p.count!);
    return [{ lead: lineOffset(box, opts) / p.speed!, fire: () => void line(pool, this.world.box, { ...opts, gaps }) }];
  }

  /**
   * Growth: the radius `a` grows every step. Drawing and collision both read `a` (bulletCircle), so
   * the hitbox is exactly the drawn size while it grows.
   */
  private growHook(rate: number): StepHook {
    return (b: Bullet, dt: number) => {
      b.a += rate * dt;
    };
  }

  // --- Blizzard: fast horizontal gusts sweep the whole box ---------------------
  private planBlizzard(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const edge = this.nextSide();
    const opts = { edge, spacing: this.rules.gustSpacing, speed: p.speed!, style: this.style('blizzard', p) };
    const off = lineOffset(box, opts);
    // The waves of one gust spawn together, each gustWaveGap of travel further back, so the first
    // arrives on the beat and the rest follow gustWaveGap apart.
    return [{
      lead: off / p.speed!,
      fire: () => {
        for (let k = 0; k < p.count!; k++) line(pool, this.world.box, { ...opts, offset: off + k * this.rules.gustWaveGap * p.speed! });
      },
    }];
  }

  private nextSide(): Wall {
    return this.rng() < 0.5 ? 'left' : 'right';
  }
}
