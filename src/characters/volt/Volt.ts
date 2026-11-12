import { Character, type LookSpec, type Shot } from '../Character';
import { resolveLevel, type ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { Bullet } from '../../combat/Bullet';
import { offscreenStart } from '../../combat/offscreen';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { STEP } from '../../core/Clock';
import { SCREEN_WIDTH } from '../../tuning';
import { theme } from '../../render/theme';
import { SOUL_SPEED } from '../../tuning';
import { boltForm, columnWidth, voltConfig, type VoltAttack, type VoltRules } from './volt.config';

export type VoltPhaseState = PhaseState<VoltAttack>;

/** Bullet flags: a warning column, a strike bolt, a fork branch, a storm bolt. */
export const VOLT_WARN = 1;
export const VOLT_BOLT = 2;
export const VOLT_BRANCH = 4;
export const VOLT_STORM = 8;

/** Down in the box's frame (bolts strike from the box's top toward its bottom). */
const DOWN = Math.PI / 2;
/** Warning columns flash at this rate (visual only). */
const WARN_BLINK = 8;

/**
 * Volt: lightning. Every attack is a warning, then a strike. Warnings are pre-active bullets that
 * never arm (drawn gold, never collide): a column for a strike, the exact branch shape for a fork.
 * A strike bolt is a jagged composite that drops from fully above the screen at boltSpeed along the
 * warned column (world-fixed, so it lands where the warning was even if the box moved), stops with
 * its tip on the box's bottom wall, collides for boltTime and fades. See volt.config.ts.
 */
export class Volt extends Character<VoltAttack, VoltRules> {
  readonly id = 'volt';
  readonly color = theme.volt;
  readonly config = voltConfig;
  protected readonly attacks = {
    strike: (p: ResolvedAttack) => this.planStrike(p),
    fork: (p: ResolvedAttack) => this.planFork(p),
    storm: (p: ResolvedAttack) => this.planStorm(p),
  };
  /** Phase as of the last step ('' until the first tick). */
  phase: VoltAttack | 'breather' | '' = '';
  /** Narrowest safe column of every storm wave fired (px), for tests and reports. */
  readonly stormSafe: number[] = [];
  /** Box-local x of the last storm wave's "reachable" safe column (the next wave's stays near it). */
  private lastSafe: number | null = null;

  private get rules(): VoltRules {
    return this.config.rules;
  }

  get order(): readonly VoltAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): VoltPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  protected override nextArrival(id: VoltAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    if (p && id === 'strike') tail = (p.burst! - 1) * p.gap! + this.rules.boltTime;
    if (p && id === 'fork') tail = this.flashOf(p) + (p.branches! - 1) * p.stagger! + this.rules.boltTime;
    if (p && id === 'storm') tail = (p.waves! - 1) * p.interval! + this.rules.boltTime;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  /** Arrival = the bolt reaches the box's top wall; plan a warning plus the drop ahead. */
  protected override planAhead(_id: VoltAttack, p: ResolvedAttack): number {
    return this.warnOf(p) + this.dropTime();
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('voltPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** Every bolt and branch variant (with glow) and the warning column, at this level. */
  override lookSpecs(): LookSpec[] {
    const r = this.rules;
    const out: LookSpec[] = [{ shape: 'rect', a: columnWidth(r) / 2, b: this.world.home.height / 2 }];
    for (let v = 0; v < r.variants; v++) {
      out.push({ shape: 'composite', form: this.bolt(v), glow: true });
      if (this.resolved.attacks.fork) out.push({ shape: 'composite', form: this.branch(v), glow: true });
    }
    return out;
  }

  private bolt(v: number) {
    const r = this.rules;
    return boltForm(r.boltLength, r.boltCore, r.boltJag, r.boltPieces, v);
  }

  private branch(v: number) {
    const r = this.rules;
    return boltForm(r.branchLength, r.boltCore, r.boltJag, Math.round(r.boltPieces * (r.branchLength / r.boltLength)), v + 100);
  }

  /** A warning's time at this level, never below rules.minWarn. */
  warnOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minWarn, p.warn!);
  }

  /** A branch's flash time, never below rules.minWarn. */
  flashOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minWarn, p.flash!);
  }

  /** Seconds from a bolt's spawn (tip one step's drop above the screen) to its tip reaching the box's top wall (at home). */
  private dropTime(): number {
    const h = this.world.home;
    return (h.y - h.height / 2 + columnWidth(this.rules)) / this.rules.boltSpeed + STEP;
  }

  /** Fork branches skipped because both directions would touch a HUD band (only while The Warden spins the box). */
  skippedBranches = 0;

  /** The last strike's columns: the next strike avoids them, so warnings never stack in one spot. */
  private recent: number[] = [];

  /** `n` column centers (box-local x) inside the soul's box, apart from each other and from the last strike's. */
  private columns(n: number): number[] {
    const box = this.world.box;
    const w = columnWidth(this.rules);
    const half = box.halfWidth - w / 2;
    const out: number[] = [];
    for (let tries = 0; out.length < n && tries < 60; tries++) {
      const x = (this.rng() * 2 - 1) * half;
      if ([...out, ...this.recent].every((o) => Math.abs(o - x) >= w * 1.5)) out.push(x);
    }
    this.recent = out;
    return out;
  }

  /** Dev (Debug sandbox): shots fired with fireNow, each kept on its own timing (waves and bursts stay apart). */
  private devQueue: { at: number; fire: () => void }[] = [];

  /**
   * Run one attack now with the params of `level`, its shots spaced as in battle (a storm's waves
   * `interval` apart, a burst's strikes `gap` apart) rather than all at once. False if not unlocked there.
   */
  override fireNow(id: VoltAttack, level = this.level): boolean {
    const p = resolveLevel(this.config, level).attacks[id];
    if (!p) return false;
    const shots = this.attacks[id](p);
    const need = Math.max(...shots.map((x) => x.lead));
    for (const x of shots) this.devQueue.push({ at: this.clock + need - x.lead, fire: x.fire });
    this.runDevQueue();
    this.world.bus.emit('attackStarted', { owner: this.id, attack: id });
    return true;
  }

  /** Ticks even at level 0, so the sandbox's queued shots play out. */
  override tick(dt: number): void {
    if (this.active) super.tick(dt);
    else this.clock += dt;
    this.runDevQueue();
  }

  private runDevQueue(): void {
    if (this.devQueue.length === 0) return;
    const due = this.devQueue.filter((q) => q.at <= this.clock + 1e-9);
    this.devQueue = this.devQueue.filter((q) => q.at > this.clock + 1e-9);
    for (const q of due) q.fire();
  }

  // --- Strike: columns flash, then bolts drop through them ---------------------------------
  private planStrike(p: ResolvedAttack): Shot[] {
    const lead = this.warnOf(p) + this.dropTime();
    const shots: Shot[] = [];
    for (let k = 0; k < p.burst!; k++) {
      // Columns are chosen when each strike fires, against the soul's box as it is then.
      shots.push({ lead: lead - k * p.gap!, fire: () => void this.strike(p, this.columns(p.count!)) });
    }
    return shots;
  }

  /**
   * Warn and strike at box-local column centers `xs` of the soul's box (as it is now): each column
   * flashes gold for warnOf(p) s, then its bolt drops. Returns the warning bullets.
   */
  strike(p: ResolvedAttack, xs: number[], flags = VOLT_BOLT, onStruck?: (bolt: Bullet) => void): Bullet[] {
    const warn = this.warnOf(p);
    const out: Bullet[] = [];
    for (const x of xs) {
      // The callback only runs once the warning exists (it is its own onStep).
      const w = this.warnColumn(x, warn, () => this.dropBolt(p, w!, flags, onStruck));
      if (w) out.push(w);
    }
    return out;
  }

  /**
   * A warning column: a box-tall gold rect (pre-active, never arms, never collides) that blinks for
   * `warn` s inside the soul's box, then calls `fire` (once) and lingers until the bolt lands.
   */
  private warnColumn(x: number, warn: number, fire: () => void): Bullet | null {
    const box = this.world.box;
    let fired = false;
    return this.world.pool.spawn({
      shape: 'rect', x, y: 0, a: columnWidth(this.rules) / 2, b: box.halfHeight, rotation: 0, damage: 0, owner: this.id, kind: 'white',
      armDelay: Infinity, blink: WARN_BLINK, noPop: true, flags: VOLT_WARN, lifetime: warn + this.dropTime() * 2 + 0.05,
      onStep: (b: Bullet) => {
        if (fired || b.age < warn - 1e-9) return;
        fired = true;
        fire();
      },
    });
  }

  /**
   * The bolt for warning column `w`: it starts fully above the screen on the column's line (box
   * frame "up"), drops at boltSpeed until its tip is on the box's bottom wall (the column's bottom),
   * collides there for boltTime and fades. World-fixed like every bullet.
   */
  private dropBolt(p: ResolvedAttack, w: Bullet, flags: number, onStruck?: (bolt: Bullet) => void): Bullet | null {
    const r = this.rules;
    const box = this.world.box;
    // The column's bottom end and its "down" direction, in the box frame as it is now.
    const dir = w.rotation + DOWN;
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const topX = w.x - dx * w.b, topY = w.y - dy * w.b;
    // Tip off screen above the column's top, on the same line, one step's drop further back: a bolt
    // spawned during the pool's update may also move in that step, and must still be off screen then.
    const os = offscreenStart(box, topX, topY, dir, columnWidth(r));
    const back = r.boltSpeed * STEP;
    const start = { x: os.x - dx * back, y: os.y - dy * back, distance: os.distance + back };
    const travel = start.distance + 2 * w.b;
    const tStop = travel / r.boltSpeed;
    let struck = false;
    const v = Math.floor(this.rng() * r.variants);
    return this.world.pool.spawn({
      shape: 'composite', form: this.bolt(v), a: 0, glow: true, noPop: true, flags,
      x: start.x - dx * r.boltLength, y: start.y - dy * r.boltLength, rotation: dir,
      vx: dx * r.boltSpeed, vy: dy * r.boltSpeed,
      damage: p.damage!, owner: this.id, kind: 'white',
      lifetime: tStop + r.boltTime,
      onStep: (b: Bullet, dt: number) => {
        if (struck) return;
        if (b.age + 1e-9 < tStop) {
          // Land exactly on the bottom wall: shorten the last step's move.
          const left = (tStop - (b.age - dt)) * r.boltSpeed;
          if (left < r.boltSpeed * dt) {
            const k = left / (r.boltSpeed * dt);
            b.vx = dx * r.boltSpeed * k;
            b.vy = dy * r.boltSpeed * k;
          }
          return;
        }
        struck = true;
        b.vx = 0;
        b.vy = 0;
        onStruck?.(b);
      },
    });
  }

  // --- Fork: a strike, then branches flash and shoot sideways from its line ------------------
  private planFork(p: ResolvedAttack): Shot[] {
    return [{ lead: this.warnOf(p) + this.dropTime(), fire: () => void this.fork(p) }];
  }

  /**
   * One column strike; when its bolt lands, `branches` branches (each a jagged bolt along the box's
   * x axis from a point on the strike line, alternating sides) show gold for flashOf(p) s (pre-active:
   * the exact branch shape, harmless), each `stagger` s after the last, then strike for boltTime.
   */
  fork(p: ResolvedAttack, x?: number): Bullet[] {
    const box = this.world.box;
    const xs = x === undefined ? this.columns(1) : [x];
    return this.strike(p, xs, VOLT_BOLT, (bolt) => this.branches(p, bolt, box.halfHeight));
  }

  private branches(p: ResolvedAttack, bolt: Bullet, hh: number): void {
    const r = this.rules;
    const n = p.branches!;
    const flash = this.flashOf(p);
    // The strike line in the box frame: the bolt points "down" in the box frame (rotation - DOWN = 0 when upright).
    const tilt = bolt.rotation - DOWN;
    const dx = Math.cos(bolt.rotation), dy = Math.sin(bolt.rotation);
    const tipX = bolt.x + dx * r.boltLength, tipY = bolt.y + dy * r.boltLength;
    let side = this.rng() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      // A point on the strike line inside the box (from 20% to 80% of its height above the tip).
      const up = 2 * hh * (0.2 + 0.6 * ((i + this.rng()) / n));
      const ox = tipX - dx * up, oy = tipY - dy * up;
      const v = Math.floor(this.rng() * r.variants);
      const arm = flash + i * p.stagger!;
      // Its flash (pre-active) must stay out of the HUD bands: when The Warden has the box turned, a
      // branch along the box's x axis can point at a band, so try the other side, else skip it.
      let placed = false;
      for (const s of [side, -side]) {
        const b = this.world.pool.spawn({
          shape: 'composite', form: this.branch(v), a: 0, x: ox, y: oy, rotation: tilt + (s > 0 ? 0 : Math.PI), glow: true, noShine: true,
          damage: p.damage!, owner: this.id, kind: 'white', flags: VOLT_BRANCH,
          armDelay: arm, lifetime: arm + r.boltTime,
        });
        if (!b) break;
        const a = bulletWorldAabb(this.world.box, b);
        if (!aabbInBand({ x0: Math.max(0, a.x0), x1: Math.min(SCREEN_WIDTH, a.x1), y0: a.y0, y1: a.y1 })) {
          placed = true;
          break;
        }
        this.world.pool.release(b, 'cancel');
      }
      if (!placed) this.skippedBranches++;
      side = -side;
    }
  }

  // --- Storm: waves of columns across the whole box with a couple of safe columns ------------
  private planStorm(p: ResolvedAttack): Shot[] {
    const lead = this.warnOf(p) + this.dropTime();
    const shots: Shot[] = [];
    this.lastSafe = null;
    for (let k = 0; k < p.waves!; k++) shots.push({ lead: lead - k * p.interval!, fire: () => void this.stormWave(p) });
    return shots;
  }

  /**
   * One storm wave over the soul's box (as it is now): bolt columns side by side across its width,
   * leaving `stormSafeCount` safe columns at least max(safe, stormSafeMin) wide (free space between
   * neighbouring columns or a column and a wall). The first safe column stays within reach of the last
   * wave's (half of what the soul walks in one interval), so a wave never asks for an impossible move;
   * the others are anywhere. Returns the safe intervals [x0, x1] it left (box-local).
   */
  stormWave(p: ResolvedAttack): [number, number][] {
    const r = this.rules;
    const box = this.world.box;
    const cw = columnWidth(r);
    const safe = Math.max(p.safe!, r.stormSafeMin);
    const hw = box.halfWidth;
    const lim = hw - safe / 2;
    const reach = SOUL_SPEED * p.interval! * 0.5;
    const centers: number[] = [];
    const first = this.lastSafe === null ? (this.rng() * 2 - 1) * lim : Math.max(-lim, Math.min(lim, this.lastSafe + (this.rng() * 2 - 1) * reach));
    centers.push(first);
    for (let tries = 0; centers.length < r.stormSafeCount && tries < 30; tries++) {
      const c = (this.rng() * 2 - 1) * lim;
      if (centers.every((o) => Math.abs(o - c) >= safe + cw)) centers.push(c);
    }
    this.lastSafe = first;
    // Columns tile the box edge to edge; any column that would touch a safe interval is left out.
    const n = Math.floor((2 * hw) / cw);
    const x0 = -hw + (2 * hw - n * cw) / 2;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = x0 + i * cw, b = a + cw;
      if (centers.some((c) => b > c - safe / 2 && a < c + safe / 2)) continue;
      xs.push(a + cw / 2);
    }
    // The real free intervals around each safe center (between the nearest kept columns or walls).
    const gaps: [number, number][] = centers.map((c) => {
      const left = Math.max(-hw, ...xs.filter((x) => x < c).map((x) => x + cw / 2));
      const right = Math.min(hw, ...xs.filter((x) => x > c).map((x) => x - cw / 2));
      return [left, right];
    });
    this.stormSafe.push(Math.min(...gaps.map(([a, b]) => b - a)));
    this.strike(p, xs, VOLT_STORM);
    return gaps;
  }
}
