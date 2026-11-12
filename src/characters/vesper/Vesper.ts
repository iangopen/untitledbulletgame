import { Character, type LookSpec, type Shot } from '../Character';
import { resolveLevel, type ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { Bullet, Wall } from '../../combat/Bullet';
import { bulletExtent } from '../../combat/Bullet';
import { lineOffset } from '../../combat/patterns';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { hud, theme } from '../../render/theme';
import { SCREEN_WIDTH, SOUL_SPEED } from '../../tuning';
import { knifeForm, vesperConfig, type VesperAttack, type VesperRules } from './vesper.config';

export type VesperPhaseState = PhaseState<VesperAttack>;

/** Bullet flags: thrown knife, encircle knife, stream knife, slash. */
export const V_THROW = 1;
export const V_RING = 2;
export const V_STREAM = 4;
export const V_SLASH = 8;

const EDGES: Wall[] = ['left', 'right', 'top', 'bottom'];
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

/**
 * Vesper: knives. Throws are off-screen bursts aimed at the soul; encircle knives form gold (pre-
 * active, harmless) in a ring around the soul inside its box with a guaranteed gap, then converge on
 * the ring's center and vanish there; flurry pours stream knives in from the edges and adds slashes,
 * each one rect bullet that is a thin gold warning along its exact path, then the slash. See vesper.config.ts.
 */
export class Vesper extends Character<VesperAttack, VesperRules> {
  readonly id = 'vesper';
  readonly color = theme.vesper;
  readonly config = vesperConfig;
  protected readonly attacks = {
    throw: (p: ResolvedAttack) => this.planThrow(p),
    encircle: (p: ResolvedAttack) => this.planEncircle(p),
    flurry: (p: ResolvedAttack) => this.planFlurry(p),
  };
  phase: VesperAttack | 'breather' | '' = '';
  /** Every encircle ring's gap where an escaping soul crosses it (px), for tests and reports. */
  readonly ringGaps: number[] = [];
  /** Slashes skipped because no clear path fit between the HUD bands (never at home). */
  skippedSlashes = 0;
  private lastSector = -1;
  private throws = 0;

  private get rules(): VesperRules {
    return this.config.rules;
  }

  get order(): readonly VesperAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): VesperPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  protected override nextArrival(id: VesperAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    if (p && id === 'throw') tail = (p.count! - 1) * this.rules.throwStagger;
    if (p && id === 'encircle') tail = (p.rings! - 1) * this.rules.ringGapTime + p.radius! / p.speed!;
    if (p && id === 'flurry') tail = p.count! * p.stagger! + this.rules.slashTime;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: VesperAttack, p: ResolvedAttack): number {
    if (id === 'encircle') return this.pauseOf(p);
    const off = maxOffscreenDistance(this.world.box, this.knifeExtent()) / p.speed!;
    return id === 'flurry' ? Math.max(off, this.warnOf(p)) : off;
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('vesperPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** The knife, and the slash's warning and active line looks (rects: one look per thickness). */
  override lookSpecs(): LookSpec[] {
    const r = this.rules;
    const out: LookSpec[] = [{ shape: 'composite', form: this.knife }];
    if (this.resolved.attacks.flurry) {
      out.push({ shape: 'rect', a: 100, b: r.warnThickness / 2 }, { shape: 'rect', a: 100, b: r.slashThickness / 2 });
    }
    return out;
  }

  private get knife() {
    return knifeForm(this.rules.knifeLength, this.rules.knifeWidth);
  }

  private knifeExtent(): number {
    return bulletExtent({ shape: 'composite', form: this.knife, a: 0 });
  }

  /** The encircle pause at this level, never below rules.minPause. */
  pauseOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minPause, p.pause!);
  }

  /** A slash warning at this level, never below rules.minWarn. */
  warnOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minWarn, p.warn ?? 0);
  }

  private knifeStyle(p: ResolvedAttack, flags: number) {
    return { shape: 'composite' as const, form: this.knife, a: 0, faceVelocity: true, noPop: true, damage: p.damage!, owner: this.id, kind: 'white' as const, flags };
  }

  // --- Throw: bursts from off screen, each knife aimed at the soul when it is thrown --------
  private planThrow(p: ResolvedAttack): Shot[] {
    // Eight directions around the box, never the same as the last burst's. The opening burst is
    // pre-fired (already part way in), so it comes from a side, beside the box and clear of the bands.
    const opening = this.throws++ === 0;
    let sector: number;
    if (opening) sector = this.rng() < 0.5 ? 0 : 4;
    else do sector = Math.floor(this.rng() * 8);
    while (!opening && sector === this.lastSector);
    this.lastSector = sector;
    // The direction the knives come FROM (box frame); they travel the other way.
    const from = (sector * Math.PI) / 4 + (this.rng() - 0.5) * (opening ? 0.2 : 0.4);
    const lead = this.throwPath(from).distance / p.speed!;
    const shots: Shot[] = [];
    for (let k = 0; k < p.count!; k++) shots.push({ lead: lead - k * this.rules.throwStagger, fire: () => void this.throwKnife(p, from, k) });
    return shots;
  }

  /** Where a knife coming from direction `from` starts (off screen) and its distance to the box edge, aimed at the soul now. */
  private throwPath(from: number, k = 0): { x: number; y: number; distance: number; tx: number; ty: number } {
    const box = this.world.box;
    const s = this.world.soul.pos;
    const dx = Math.cos(from), dy = Math.sin(from);
    // The box edge on the soul's side toward `from`, then back off screen along the travel line.
    const tx = Math.abs(dx) > 1e-9 ? (dx > 0 ? box.halfWidth - s.x : box.halfWidth + s.x) / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-9 ? (dy > 0 ? box.halfHeight - s.y : box.halfHeight + s.y) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    const ex = s.x + dx * t, ey = s.y + dy * t;
    // Burst knives sit a little apart along the line across the travel direction.
    const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * this.rules.knifeWidth * 2.2;
    const px0 = ex - dy * side, py0 = ey + dx * side;
    const st = offscreenStart(box, px0, py0, from + Math.PI, this.knifeExtent());
    return { x: st.x, y: st.y, distance: st.distance, tx: s.x, ty: s.y };
  }

  /** One thrown knife from off screen, aimed at the soul's position now (follow-the-box). */
  throwKnife(p: ResolvedAttack, from: number, k = 0): Bullet | null {
    const path = this.throwPath(from, k);
    const dx = path.tx - path.x, dy = path.ty - path.y;
    const d = Math.hypot(dx, dy) || 1;
    return this.world.pool.spawn({ ...this.knifeStyle(p, V_THROW), x: path.x, y: path.y, vx: (dx / d) * p.speed!, vy: (dy / d) * p.speed! });
  }

  // --- Encircle: a gold ring with a gap around the soul, then the knives converge ---------
  private planEncircle(p: ResolvedAttack): Shot[] {
    const shots: Shot[] = [];
    for (let k = 0; k < p.rings!; k++) shots.push({ lead: this.pauseOf(p) - k * this.rules.ringGapTime, fire: () => void this.ring(p) });
    return shots;
  }

  /** Gap (px, between the knives' guards) of a ring of radius `r` with `g` empty slots, where a soul escaping at full speed crosses it. */
  ringGap(r: number, g: number, speed: number): { gap: number; atRadius: number } {
    const step = (2 * Math.PI) / this.rules.ringSlots;
    const rm = (r * SOUL_SPEED) / (SOUL_SPEED + speed);
    return { gap: 2 * rm * Math.sin(((g + 1) * step) / 2) - this.rules.knifeWidth * 1.9, atRadius: rm };
  }

  /**
   * A ring of knives around the soul (centered on it, moved in so the whole ring stays inside the
   * soul's box, the radius shrunk if the box is too small), pointing at its center, gold for pauseOf(p)
   * s (pre-active: harmless). Some neighbouring slots are left empty: enough that the gap is at least
   * max(gap, minGap) wide where a soul leaving at full speed meets the closing ring. Then the knives
   * fly at the center and vanish there. The gap faces one of the 8 movement directions with a clear
   * way out. Returns the knives, the gap's center angle and the ring's center.
   */
  ring(p: ResolvedAttack): { knives: Bullet[]; gapAngle: number; center: { x: number; y: number } } {
    const r = this.rules;
    const box = this.world.box;
    const kl = r.knifeLength;
    const rad = Math.max(kl * 1.5, Math.min(p.radius!, box.halfWidth - kl, box.halfHeight - kl));
    const lim = { x: Math.max(0, box.halfWidth - rad - kl / 2), y: Math.max(0, box.halfHeight - rad - kl / 2) };
    const s = this.world.soul.pos;
    const center = { x: Math.max(-lim.x, Math.min(lim.x, s.x)), y: Math.max(-lim.y, Math.min(lim.y, s.y)) };
    const need = Math.max(p.gap!, r.minGap);
    let g = 1;
    while (g < r.ringSlots - 3 && this.ringGap(rad, g, p.speed!).gap < need) g++;
    this.ringGaps.push(this.ringGap(rad, g, p.speed!).gap);
    const step = (2 * Math.PI) / r.ringSlots;
    const first = Math.floor(this.rng() * r.ringSlots);
    // The gap faces one of the 8 movement directions (movement is 8-way), one whose way out stays
    // inside the box (not into a wall), so the soul can run straight out through its middle.
    const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j]!, dirs[i]!];
    }
    const out = rad + kl;
    const soulR = this.world.soul.hitRadius;
    const gapDir = dirs.find((d) => Math.abs(center.x + Math.cos(d) * out) <= box.halfWidth - soulR && Math.abs(center.y + Math.sin(d) * out) <= box.halfHeight - soulR) ?? dirs[0]!;
    const spin = gapDir - (first + (g - 1) / 2) * step;
    const pause = this.pauseOf(p);
    const knives: Bullet[] = [];
    for (let i = 0; i < r.ringSlots; i++) {
      // Slots first .. first + g - 1 are the gap.
      if ((i - first + r.ringSlots) % r.ringSlots < g) continue;
      const a = spin + i * step;
      const speed = p.speed!;
      const b = this.world.pool.spawn({
        ...this.knifeStyle(p, V_RING), faceVelocity: false,
        x: center.x + Math.cos(a) * rad, y: center.y + Math.sin(a) * rad, rotation: a + Math.PI,
        armDelay: pause, growIn: true, lifetime: pause + rad / speed,
        onArm: (k: Bullet) => {
          k.vx = Math.cos(k.rotation) * speed;
          k.vy = Math.sin(k.rotation) * speed;
        },
      });
      if (b) knives.push(b);
    }
    return { knives, gapAngle: spin + (first + (g - 1) / 2) * step, center };
  }

  // --- Flurry: streams from the edges plus slashes with gold warnings ----------------------
  private planFlurry(p: ResolvedAttack): Shot[] {
    const shots: Shot[] = [];
    const edges = [...EDGES];
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [edges[i], edges[j]] = [edges[j]!, edges[i]!];
    }
    const style = this.knifeStyle(p, V_STREAM);
    for (const edge of edges.slice(0, Math.min(4, p.streams!))) {
      const lead = lineOffset(this.world.box, { edge, style }) / p.speed!;
      for (let j = 0; j < p.count!; j++) {
        const u = this.rng() * 2 - 1;
        const delay = (j + this.rng() * 0.5) * p.stagger!;
        shots.push({ lead: lead - delay, fire: () => void this.streamKnife(p, edge, u) });
      }
    }
    const warn = this.warnOf(p);
    const span = p.count! * p.stagger!;
    for (let k = 0; k < p.slashes!; k++) {
      const at = ((k + 0.5) / p.slashes!) * span;
      const c: [number, number] = [(this.rng() * 2 - 1) * 0.5, (this.rng() * 2 - 1) * 0.5];
      const ang = this.rng() * Math.PI;
      shots.push({ lead: warn - at, fire: () => void this.slash(p, c, ang) });
    }
    return shots;
  }

  /** One stream knife from off screen beyond `edge` of the soul's box (as it is now), at `u` of the edge's half length, flying straight in. */
  streamKnife(p: ResolvedAttack, edge: Wall, u: number): Bullet | null {
    const box = this.world.box;
    const style = this.knifeStyle(p, V_STREAM);
    const off = lineOffset(box, { edge, style });
    const [nx, ny] = INWARD[edge];
    const along = nx !== 0 ? box.halfHeight : box.halfWidth;
    const lane = Math.round((u * (along - this.rules.knifeWidth)) / this.rules.streamSpacing) * this.rules.streamSpacing;
    const x = nx !== 0 ? -nx * (box.halfWidth + off) : lane;
    const y = ny !== 0 ? -ny * (box.halfHeight + off) : lane;
    return this.world.pool.spawn({ ...style, x, y, vx: nx * p.speed!, vy: ny * p.speed! });
  }

  /**
   * One slash through the soul's box: a rect bullet through the point `c` (fractions of the half
   * extents) at angle `ang` (box frame). Pre-active and thin for warnOf(p) s, it is the warning line,
   * exactly the slash's path (the same bullet); on arming it becomes the slash (slashThickness) for
   * slashTime s, then it is gone. Its length is cut so the whole line stays between the HUD bands
   * and on screen across; skipped if it would be too short to cross the box.
   */
  slash(p: ResolvedAttack, c: [number, number], ang: number): Bullet | null {
    const r = this.rules;
    const box = this.world.box;
    const warn = this.warnOf(p);
    const local = { x: c[0] * box.halfWidth, y: c[1] * box.halfHeight };
    const w = box.toWorld(local, { x: 0, y: 0 });
    const wa = ang + box.rotation;
    const dx = Math.cos(wa), dy = Math.sin(wa);
    const m = r.slashThickness + 2;
    const top = hud.top.y + hud.top.height + m, bottom = hud.bottom.y - m;
    // Longest half length with both ends between the bands (y) and on screen (x), at most the box's diagonal.
    let half = Math.hypot(box.halfWidth, box.halfHeight) + r.knifeLength;
    if (Math.abs(dy) > 1e-9) half = Math.min(half, (w.y - top) / Math.abs(dy), (bottom - w.y) / Math.abs(dy));
    if (Math.abs(dx) > 1e-9) half = Math.min(half, (w.x - m) / Math.abs(dx), (SCREEN_WIDTH - m - w.x) / Math.abs(dx));
    if (half < Math.min(box.halfWidth, box.halfHeight)) {
      this.skippedSlashes++;
      return null;
    }
    const b = this.world.pool.spawn({
      shape: 'rect', x: local.x, y: local.y, rotation: ang, a: half, b: r.warnThickness / 2,
      damage: p.damage!, owner: this.id, kind: 'white', noPop: true, noShine: true, flags: V_SLASH,
      armDelay: warn, lifetime: warn + r.slashTime,
      onArm: (s: Bullet) => {
        s.b = r.slashThickness / 2;
      },
    });
    if (!b) return null;
    const a = bulletWorldAabb(box, b);
    if (aabbInBand({ x0: Math.max(0, a.x0), x1: Math.min(SCREEN_WIDTH, a.x1), y0: a.y0, y1: a.y1 })) {
      this.world.pool.release(b, 'cancel');
      this.skippedSlashes++;
      return null;
    }
    return b;
  }

  // --- Debug sandbox: shots keep their own timing (bursts, streams, second rings) ----------
  private devQueue: { at: number; fire: () => void }[] = [];

  override fireNow(id: VesperAttack, level = this.level): boolean {
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
}
