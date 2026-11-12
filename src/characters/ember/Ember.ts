import { Character, type LookSpec, type Shot } from '../Character';
import type { ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import { bulletExtent, type Bullet, type StepHook, type Wall } from '../../combat/Bullet';
import { line, lineOffset, lineSlots, type BulletStyle } from '../../combat/patterns';
import { maxOffscreenDistance } from '../../combat/offscreen';
import { BOX_HEIGHT } from '../../tuning';
import { theme } from '../../render/theme';
import { emberConfig, flameWallForm, type EmberAttack, type EmberRules } from './ember.config';

export type EmberPhaseState = PhaseState<EmberAttack>;

const OUTWARD: Record<Wall, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

/**
 * Ember: support character, every projectile orange (hurts only a still soul; see ember.config.ts).
 * Embers and fire sweeps are rows from the `line` pattern that start off screen and travel in;
 * wildfire rings form just outside the box and grow across it. Per-bullet motion (drift, flicker,
 * growth) lives in onStep hooks, and drawing and collision read the same fields.
 */
export class Ember extends Character<EmberAttack, EmberRules> {
  readonly id = 'ember';
  readonly color = theme.ember;
  readonly config = emberConfig;
  protected readonly attacks = {
    embers: (p: ResolvedAttack) => this.planEmbers(p),
    sweep: (p: ResolvedAttack) => this.planSweep(p),
    wildfire: (p: ResolvedAttack) => this.planWildfire(p),
  };
  /** Embers and sweeps spawn off screen, so the opening waits for the travel time. */
  protected override readonly preFireOpening = false;
  /** Phase as of the last step ('' until the first tick). */
  phase: EmberAttack | 'breather' | '' = '';
  private lastRingWall: Wall | null = null;

  private get rules(): EmberRules {
    return this.config.rules;
  }

  get order(): readonly EmberAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): EmberPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  /** Arrivals only inside the attack's own phase; a sweep's later walls and a volley's later rings too. */
  protected override nextArrival(id: EmberAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    // A sweep's walls must also have crossed the box before its phase ends (they are slow).
    if (p && id === 'sweep') tail = (p.count! - 1) * this.rules.sweepWaveGap + this.world.home.width / p.speed!;
    if (p && id === 'wildfire') tail = (p.count! - 1) * this.rules.ringStagger;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: EmberAttack, p: ResolvedAttack): number {
    if (id === 'wildfire') return this.ringLead(p);
    return maxOffscreenDistance(this.world.box, bulletExtent(this.style(id, p))) / p.speed!;
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('emberPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** Bullet style per attack. Every projectile is orange. */
  private style(id: EmberAttack, p: ResolvedAttack): BulletStyle {
    const base = { damage: p.damage!, owner: this.id, kind: 'orange' as const, noPop: true };
    if (id === 'embers') return { ...base, shape: 'circle', a: p.size!, onStep: this.sparkHook(p.drift!, p.size!) };
    if (id === 'sweep') return { ...base, shape: 'composite', form: this.wallForm(p), a: 0, faceVelocity: true };
    return { ...base, shape: 'ring', a: p.thickness!, b: p.thickness! };
  }

  /** The flame wall covers `cover` of the default box height (a fixed size, so it is one cached look). */
  private wallForm(p: ResolvedAttack) {
    return flameWallForm(BOX_HEIGHT * p.cover!, this.rules.sweepThickness);
  }

  /** Every look at this level: spark radii through the flicker, the flame wall, the ring segment. */
  override lookSpecs(): LookSpec[] {
    const out: LookSpec[] = [];
    const at = this.resolved.attacks;
    if (at.embers) {
      const s = at.embers.size!;
      const radii: number[] = [];
      for (let r = s * (1 - this.rules.flicker) * 0.98; r <= s * 1.16; r *= 1.05) radii.push(r);
      out.push({ shape: 'circle', radii });
    }
    if (at.sweep) out.push({ shape: 'composite', form: this.wallForm(at.sweep) });
    if (at.wildfire) out.push({ shape: 'ring', a: at.wildfire.thickness!, b: at.wildfire.thickness! });
    return out;
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

  // --- Embers: sparks rise from below the screen, drifting and flickering ---------
  private planEmbers(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const style = this.style('embers', p);
    const opts = { edge: 'bottom' as const, spacing: this.rules.sparkSpacing, speed: p.speed!, style };
    const gaps = this.gapsFor(lineSlots(box, opts), p.count!);
    return [{ lead: lineOffset(box, opts) / p.speed!, fire: () => void line(pool, this.world.box, { ...opts, gaps }) }];
  }

  /**
   * Drift x(t) = amp * sin(freq * t + phase) and a flicker: the radius pulses down by up to
   * `flicker` of its size. Drawing and collision both read `a`, so the hitbox flickers with it. On
   * its first step each spark picks a phase and a speed up to sparkSpeedSpread faster, moving back
   * by the same factor so it still reaches the box on the beat (and stays off screen).
   */
  private sparkHook(amp: number, size: number): StepHook {
    const { driftFreq: w, flicker, flickerFreq: ff, sparkSpeedSpread: spread } = this.rules;
    return (b: Bullet) => {
      if (b.flags === 0) {
        b.flags = 1 + Math.floor(this.rng() * 1e6);
        const f = 1 + this.rng() * spread;
        const bottom = this.world.box.halfHeight;
        b.y = bottom + (b.y - bottom) * f;
        b.vy *= f;
        b.snapshot();
      }
      b.vx = amp * w * Math.cos(w * b.age + b.flags);
      b.a = size * (1 - flicker * 0.5 * (1 + Math.sin(ff * b.age + b.flags * 0.37)));
    };
  }

  // --- Fire sweep: slow walls of flame sweep across the box from a side ------------
  private planSweep(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const edge: Wall = this.rng() < 0.5 ? 'left' : 'right';
    const opts = { edge, count: 1, speed: p.speed!, style: this.style('sweep', p) };
    const off = lineOffset(box, opts);
    // The walls of one sweep spawn together, each sweepWaveGap of travel further back.
    return [{
      lead: off / p.speed!,
      fire: () => {
        // Off screen for the box as it is NOW (it may be shoved, tossed or turned since the plan).
        const box = this.world.box;
        const at = lineOffset(box, opts);
        for (let k = 0; k < p.count!; k++) line(pool, box, { ...opts, offset: at + k * this.rules.sweepWaveGap * p.speed! });
      },
    }];
  }

  // --- Wildfire: rings form just outside a wall and grow inward across the box ------
  private planWildfire(p: ResolvedAttack): Shot[] {
    const lead = this.ringLead(p);
    const shots: Shot[] = [];
    const first = this.nextRingWall();
    const opposite: Record<Wall, Wall> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    for (let k = 0; k < p.count!; k++) {
      const wall = k % 2 === 0 ? first : opposite[first];
      shots.push({ lead: lead - k * this.rules.ringStagger, fire: () => this.ring(p, wall) });
    }
    return shots;
  }

  /** A ring starts with its inner edge at its center; its outer edge reaches the wall line ringGap - thickness later. */
  private ringLead(p: ResolvedAttack): number {
    return Math.max(0, this.rules.ringGap - p.thickness!) / p.speed!;
  }

  private nextRingWall(): Wall {
    const all: Wall[] = ['left', 'right', 'top', 'bottom'];
    const choices = all.filter((w) => w !== this.lastRingWall);
    const w = choices[Math.floor(this.rng() * choices.length)]!;
    this.lastRingWall = w;
    return w;
  }

  /**
   * One ring centered `ringGap` outside the middle of `wall` of the soul's box (as it is now),
   * starting as a disc (inner edge at the center) and growing at `speed` until it has passed the far corners.
   */
  ring(p: ResolvedAttack, wall: Wall): Bullet | null {
    const box = this.world.box;
    const [nx, ny] = OUTWARD[wall];
    const g = this.rules.ringGap;
    const cx = nx * (box.halfWidth + g), cy = ny * (box.halfHeight + g);
    // Far corners: across the box from the ring's center.
    const far = Math.hypot(Math.abs(cx) + box.halfWidth, Math.abs(cy) + box.halfHeight);
    const t = p.thickness!;
    const rate = p.speed!;
    return this.world.pool.spawn({
      ...this.style('wildfire', p),
      a: t / 2,
      x: cx,
      y: cy,
      lifetime: (far + t) / rate,
      onStep: (b: Bullet, dt: number) => {
        b.a += rate * dt;
      },
    });
  }
}
