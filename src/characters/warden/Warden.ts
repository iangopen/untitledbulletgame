import { Character, type LookSpec, type Shot } from '../Character';
import { resolveLevel, type ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { Bullet, Wall } from '../../combat/Bullet';
import { PLAY_BOTTOM, PLAY_TOP, rotatedHalfExtents } from '../../combat/bands';
import { theme, VIEW } from '../../render/theme';
import { FIST_DEPTH, FIST_FORM, wardenConfig, type WardenAttack, type WardenRules } from './warden.config';

export type WardenPhaseState = PhaseState<WardenAttack>;

/** Inward unit normal for each wall (the way a fist on that wall punches). */
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };
const OPPOSITE: Record<Wall, Wall> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** One punch-and-return: which wall the first fist hits (the return comes from the opposite one). */
interface PunchPlan {
  wall: Wall | null;
}

/**
 * The Warden: support golem. Fists form just outside a wall (decor bullets: drawn, never collide,
 * never inside the box), wind up, punch, and shove the box across the screen with Box.moveTo (the
 * soul rides along; other characters' bullets stay world-fixed, so the box is pushed into them).
 * A little later a fist from the other side punches it back home. Spins swing the box with
 * Box.rotateTo. All motion runs on the Box's fixed-step tracks, so it pauses with the game.
 * Every move is clamped so the box (and the fists) stay on screen and clear of the HUD bands.
 */
export class Warden extends Character<WardenAttack, WardenRules> {
  readonly id = 'warden';
  readonly color = theme.warden;
  readonly config = wardenConfig;
  protected readonly attacks = {
    punch: (p: ResolvedAttack) => this.planPunch(p),
    spin: (p: ResolvedAttack) => this.startSpin(p),
  };
  /** Nothing travels in from off screen; the fist's wind-up is the lead. */
  protected override readonly preFireOpening = false;
  /** Phase as of the last step ('' until the first tick). */
  phase: WardenAttack | 'breather' | '' = '';
  /** Counters for verification: punches that shoved the box, return punches, spins started. */
  readonly stats = { punches: 0, returns: 0, spins: 0, swings: 0 };

  private spin: { until: number; speed: number; reverse: number; swingEnd: number; dir: 1 | -1; returning: boolean } | null = null;

  private get rules(): WardenRules {
    return this.config.rules;
  }

  get order(): readonly WardenAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): WardenPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  /** Impacts and spin starts only inside the attack's phase, with room for the return / the spin itself. */
  protected override nextArrival(id: WardenAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    if (p && id === 'punch') tail = p.back! + this.rules.shoveTime + this.rules.fistLinger;
    if (p && id === 'spin') tail = p.duration! + this.rules.spinReturn;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: WardenAttack, p: ResolvedAttack): number {
    return id === 'punch' ? p.windup! + this.rules.lungeTime : 0;
  }

  override lookSpecs(): LookSpec[] {
    return [{ shape: 'composite', form: FIST_FORM, decor: true }];
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('wardenPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
    this.stepSpin();
  }

  // --- Punch: wind up outside a wall, punch, shove the box; then a punch back from the other side ---
  private planPunch(p: ResolvedAttack): Shot[] {
    const r = this.rules;
    const lead = p.windup! + r.lungeTime;
    const plan: PunchPlan = { wall: null };
    const vertical = this.rng() < p.vertical!;
    const sign = this.rng() < 0.5 ? -1 : 1;
    return [
      { lead, fire: () => this.firstPunch(p, plan, vertical, sign) },
      // The return: `back` s after the impact, from the opposite wall, home.
      { lead: lead - p.back!, fire: () => this.returnPunch(p, plan) },
    ];
  }

  private firstPunch(p: ResolvedAttack, plan: PunchPlan, vertical: boolean, sign: number): void {
    // Wall the fist hits: pushing toward +sign on the chosen axis means a fist on the -sign wall.
    const walls: Wall[] = vertical ? (sign > 0 ? ['top', 'bottom'] : ['bottom', 'top']) : sign > 0 ? ['left', 'right'] : ['right', 'left'];
    const want = p.distance!;
    for (const wall of walls) {
      if (!this.fistFits(wall)) continue;
      const room = this.shoveRoom(wall);
      if (room < want * this.rules.minShoveFraction && wall !== walls[walls.length - 1]) continue;
      if (room < 1) continue;
      plan.wall = wall;
      this.spawnFist(p, wall, () => {
        const [nx, ny] = this.worldDir(wall);
        const d = Math.min(want, this.shoveRoom(wall));
        const box = this.world.box;
        box.moveTo(box.x + nx * d, box.y + ny * d, this.rules.shoveTime, 'cubicOut');
        this.stats.punches++;
      });
      return;
    }
  }

  private returnPunch(p: ResolvedAttack, plan: PunchPlan): void {
    if (!plan.wall) return;
    const box = this.world.box;
    const home = box.defaults;
    if (Math.hypot(box.x - home.x, box.y - home.y) < 1) return;
    const wall = OPPOSITE[plan.wall];
    this.spawnFist(p, wall, () => {
      box.moveTo(home.x, home.y, this.rules.shoveTime, 'cubicOut');
      this.stats.returns++;
    });
  }

  /** World direction a fist on `wall` pushes the box (its inward normal, turned with the box). */
  private worldDir(wall: Wall): [number, number] {
    const [nx, ny] = INWARD[wall];
    const rot = this.world.box.rotation;
    const c = Math.cos(rot), s = Math.sin(rot);
    return [nx * c - ny * s, nx * s + ny * c];
  }

  /** Space a fist needs beyond a wall: gap + wind-up pull + its depth. */
  private get fistReach(): number {
    return this.rules.fistGap + this.rules.fistPull + FIST_DEPTH;
  }

  /**
   * How far the box can be pushed by a fist on `wall` (px along the push) and keep its rotated
   * outline on screen and clear of the HUD bands, with room left beyond the far wall for the fist
   * that punches it back.
   */
  private shoveRoom(wall: Wall): number {
    const box = this.world.box;
    const { hx, hy } = rotatedHalfExtents(box.width, box.height, box.rotation);
    const m = this.rules.margin;
    const [dx, dy] = this.worldDir(wall);
    const far = this.fistReach;
    let room = Infinity;
    if (dx > 1e-6) room = Math.min(room, (VIEW.width - m - far - (box.x + hx)) / dx);
    if (dx < -1e-6) room = Math.min(room, (box.x - hx - m - far) / -dx);
    if (dy > 1e-6) room = Math.min(room, (PLAY_BOTTOM - m - far - (box.y + hy)) / dy);
    if (dy < -1e-6) room = Math.min(room, (box.y - hy - PLAY_TOP - m - far) / -dy);
    return Math.max(0, room);
  }

  /** Whether a fist fully drawn back on `wall` stays on screen and clear of the HUD bands. */
  private fistFits(wall: Wall): boolean {
    const box = this.world.box;
    const { hx, hy } = rotatedHalfExtents(box.width, box.height, box.rotation);
    const m = this.rules.margin;
    const far = this.fistReach;
    switch (wall) {
      case 'left': return box.x - hx - far >= m;
      case 'right': return box.x + hx + far <= VIEW.width - m;
      case 'top': return box.y - hy - far >= PLAY_TOP + m;
      case 'bottom': return box.y + hy + far <= PLAY_BOTTOM - m;
    }
  }

  /**
   * A fist on `wall`, pinned to the box every step (box-local, at the middle of the wall, facing in):
   * forms at fistGap and draws back by fistPull over the wind-up, lunges to the wall, calls `impact`
   * as it lands, rides the wall while the box slides, then is gone (fading). Decor: never collides.
   */
  private spawnFist(p: ResolvedAttack, wall: Wall, impact: () => void): void {
    const r = this.rules;
    const [nx, ny] = INWARD[wall];
    const windup = p.windup!;
    const hitAt = windup + r.lungeTime;
    let hit = false;
    const place = (b: Bullet) => {
      const box = this.world.box;
      const t = b.age;
      let d: number;
      if (t < windup) d = r.fistGap + r.fistPull * Math.sin((Math.PI / 2) * (t / windup));
      else if (t < hitAt) d = (r.fistGap + r.fistPull) * (1 - (t - windup) / r.lungeTime);
      else d = 0;
      // Wall point (middle of the wall) plus the distance outward; the fist's front faces the box.
      b.x = -nx * (box.halfWidth + d);
      b.y = -ny * (box.halfHeight + d);
      b.rotation = Math.atan2(ny, nx);
      b.vx = 0;
      b.vy = 0;
      if (!hit && t >= hitAt - 1e-9) {
        hit = true;
        impact();
      }
    };
    const b = this.world.pool.spawn({
      shape: 'composite', form: FIST_FORM, a: 0, x: 0, y: 0, damage: 0, owner: this.id,
      decor: true, tint: theme.wardenFist, lifetime: hitAt + r.shoveTime + r.fistLinger, onStep: place,
    });
    if (b) {
      place(b);
      b.snapshot();
    }
  }

  // --- Spin: the box swings back and forth (rotation only), then turns back to 0 ---
  private startSpin(p: ResolvedAttack): void {
    this.spin = { until: this.clock + p.duration!, speed: p.speed!, reverse: p.reverse!, swingEnd: this.clock, dir: this.rng() < 0.5 ? 1 : -1, returning: false };
    this.stats.spins++;
  }

  /**
   * The largest angle (rad, up to spinMaxAngle) the box can turn to from upright and still have
   * its whole outline on screen and clear of the HUD bands at every angle on the way.
   */
  safeAngle(): number {
    const box = this.world.box;
    const m = this.rules.margin;
    const roomY = Math.min(box.y - PLAY_TOP, PLAY_BOTTOM - box.y) - m;
    const roomX = Math.min(box.x, VIEW.width - box.x) - m;
    let a = 0;
    // Extents grow with the angle up to the diagonal, so the first angle that does not fit ends it.
    for (let t = 0; t <= this.rules.spinMaxAngle + 1e-9; t += 0.005) {
      const e = rotatedHalfExtents(box.width, box.height, t);
      if (e.hx > roomX || e.hy > roomY) break;
      a = t;
    }
    return a;
  }

  private stepSpin(): void {
    const s = this.spin;
    if (!s) return;
    const box = this.world.box;
    if (this.clock >= s.until) {
      if (!s.returning) {
        s.returning = true;
        box.rotateTo(0, this.rules.spinReturn, 'sineInOut');
      } else if (this.clock >= s.until + this.rules.spinReturn) {
        this.spin = null;
      }
      return;
    }
    if (this.clock < s.swingEnd - 1e-9) return;
    // Next swing: toward side `dir` (most of the safe angle), then the side flips. Sometimes it
    // reverses early instead: it stops half way there and turns back.
    const A = this.safeAngle();
    if (A <= 0) return;
    const full = s.dir * A * (0.75 + 0.25 * this.rng());
    const target = this.rng() < s.reverse ? box.rotation + 0.5 * (full - box.rotation) : full;
    s.dir = s.dir === 1 ? -1 : 1;
    const dur = Math.min(Math.abs(target - box.rotation) / s.speed, s.until - this.clock);
    if (dur <= 1e-3) return; // nothing to turn this step; try the other side next step
    box.rotateTo(target, dur, 'sineInOut');
    s.swingEnd = this.clock + dur;
    this.stats.swings++;
  }

  /** Dev (DebugScene): shots fired with fireNow, kept on their own lead times. */
  private devQueue: { at: number; fire: () => void }[] = [];

  /**
   * Dev tool: run a punch (with its return, each on its own timing) or a spin now with the params
   * of `level`. The punch's impact lands one wind-up from now.
   */
  override fireNow(id: WardenAttack, level = this.level): boolean {
    const p = resolveLevel(this.config, level).attacks[id];
    if (!p) return false;
    if (id === 'spin') this.startSpin(p);
    else {
      const shots = this.planPunch(p);
      const need = Math.max(...shots.map((x) => x.lead));
      for (const x of shots) this.devQueue.push({ at: this.clock + need - x.lead, fire: x.fire });
      this.runDevQueue();
    }
    this.world.bus.emit('attackStarted', { owner: this.id, attack: id });
    return true;
  }

  /** Ticks even at level 0, so DebugScene's fireNow punches and spins play out. */
  override tick(dt: number): void {
    if (this.active) super.tick(dt);
    else {
      this.clock += dt;
      this.stepSpin();
    }
    this.runDevQueue();
  }

  private runDevQueue(): void {
    if (this.devQueue.length === 0) return;
    const due = this.devQueue.filter((q) => q.at <= this.clock + 1e-9);
    this.devQueue = this.devQueue.filter((q) => q.at > this.clock + 1e-9);
    for (const q of due) q.fire();
  }

  override dispose(): void {
    this.spin = null;
    this.devQueue = [];
  }
}
