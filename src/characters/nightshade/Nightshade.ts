import { Character, type LookSpec, type Shot } from '../Character';
import { resolveLevel, type ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { Bullet, Wall } from '../../combat/Bullet';
import { ring } from '../../combat/patterns';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { theme } from '../../render/theme';
import { nightshadeConfig, podForm, type NightshadeAttack, type NightshadeRules } from './nightshade.config';

export type NightshadePhaseState = PhaseState<NightshadeAttack>;

/** Bullet flags: a spore drifting in, a miasma strip, a forming pod, a burst ring spore. */
export const N_SPORE = 1;
export const N_STRIP = 2;
export const N_POD = 4;
export const N_RING = 8;

const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

/**
 * Nightshade: KR poison. Every projectile is `kind: 'kr'` (KR fills the pool, which never takes HP
 * below 1). Spores drift in from off screen and linger; miasma clouds fill one side of the box strip
 * by strip (each strip gold for a moment first) and always leave rules.minClear of it clear; pods
 * form gold inside the box and burst into rings of spores. Every spore and strip is a solid disc or
 * rect whose edge is exactly its hitbox; the shimmer is drawn alpha only. See nightshade.config.ts.
 */
export class Nightshade extends Character<NightshadeAttack, NightshadeRules> {
  readonly id = 'nightshade';
  readonly color = theme.nightshade;
  readonly config = nightshadeConfig;
  protected readonly attacks = {
    spores: (p: ResolvedAttack) => this.planSpores(p),
    miasma: (p: ResolvedAttack) => this.planMiasma(p),
    burst: (p: ResolvedAttack) => this.planBurst(p),
  };
  phase: NightshadeAttack | 'breather' | '' = '';
  /** Every miasma cloud's clear fraction of the box (along its depth), for tests and reports. */
  readonly clears: number[] = [];
  private drifts = 0;
  private lastWall: Wall | null = null;

  private get rules(): NightshadeRules {
    return this.config.rules;
  }

  get order(): readonly NightshadeAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): NightshadePhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  protected override nextArrival(id: NightshadeAttack, at: number): number {
    const p = this.resolved.attacks[id];
    const tail = p && id === 'miasma' ? (p.strips! - 1) * p.spread! : 0;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: NightshadeAttack, p: ResolvedAttack): number {
    if (id === 'miasma') return this.rules.stripForm;
    if (id === 'burst') return this.formOf(p);
    return maxOffscreenDistance(this.world.box, this.rules.sporeSize) / p.speed!;
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('nightshadePhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** The spore disc, the cloud strip (one stretched look per thickness) and the pod. */
  override lookSpecs(): LookSpec[] {
    const r = this.rules;
    const out: LookSpec[] = [{ shape: 'circle', a: r.sporeSize }];
    if (this.resolved.attacks.miasma) out.push({ shape: 'rect', a: 200, b: r.stripWidth / 2 });
    if (this.resolved.attacks.burst) out.push({ shape: 'composite', form: podForm(r.podSize) });
    return out;
  }

  /** The pod forming time at this level, never below rules.minForm. */
  formOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minForm, p.form ?? 0);
  }

  private sporeStyle(p: ResolvedAttack, flags: number) {
    return { shape: 'circle' as const, a: this.rules.sporeSize, damage: p.damage!, owner: this.id, kind: 'kr' as const, noPop: true, flicker: this.rules.shimmer, flags };
  }

  // --- Spores: slow puffs drift in from off screen, stop inside the box and linger ----------
  private planSpores(p: ResolvedAttack): Shot[] {
    // The opening drift is pre-fired (part way in): from the sides, so it never shows in a HUD band.
    const opening = this.drifts++ === 0;
    const shots: Shot[] = [];
    for (let k = 0; k < p.count!; k++) {
      const wall: Wall = opening ? (this.rng() < 0.5 ? 'left' : 'right') : (['left', 'right', 'top', 'bottom'] as const)[Math.floor(this.rng() * 4)]!;
      const u = this.rng() * 2 - 1;
      const target: [number, number] = [(this.rng() * 2 - 1) * 0.75, (this.rng() * 2 - 1) * 0.75];
      const drift = this.rng() * Math.PI * 2;
      shots.push({ lead: this.sporeLead(p, wall, u), fire: () => void this.spore(p, wall, u, target, drift) });
    }
    return shots;
  }

  /** Where a spore crosses `wall` (box-local, at `u` of its half length) and its off-screen start before it. */
  private sporeEntry(wall: Wall, u: number) {
    const box = this.world.box;
    const [nx, ny] = INWARD[wall];
    const ex = nx !== 0 ? -nx * box.halfWidth : u * box.halfWidth * 0.8;
    const ey = ny !== 0 ? -ny * box.halfHeight : u * box.halfHeight * 0.8;
    return { ex, ey, start: offscreenStart(box, ex, ey, Math.atan2(ny, nx), this.rules.sporeSize) };
  }

  private sporeLead(p: ResolvedAttack, wall: Wall, u: number): number {
    return this.sporeEntry(wall, u).start.distance / p.speed!;
  }

  /**
   * One spore: from off screen beyond `wall` (soul's box as it is now) through its wall point to a
   * target inside the box (fractions of the half extents), where it stops and lingers `linger` s,
   * drifting slowly, then fades. Its stop is tested against the target in world space, so it holds
   * even if the box moves (bullets are world-fixed) or the spore was pre-fired part way in.
   */
  spore(p: ResolvedAttack, wall: Wall, u: number, target: [number, number], drift: number): Bullet | null {
    const box = this.world.box;
    const { start } = this.sporeEntry(wall, u);
    const tl = { x: target[0] * box.halfWidth, y: target[1] * box.halfHeight };
    const dx0 = tl.x - start.x, dy0 = tl.y - start.y;
    const d = Math.hypot(dx0, dy0) || 1;
    const tw = box.toWorld(tl, { x: 0, y: 0 });
    const tmp = { x: 0, y: 0 };
    let lingering = false;
    const r = this.rules;
    return this.world.pool.spawn({
      ...this.sporeStyle(p, N_SPORE), x: start.x, y: start.y, vx: (dx0 / d) * p.speed!, vy: (dy0 / d) * p.speed!,
      onStep: (b: Bullet) => {
        if (lingering) return;
        const t = this.world.box.toLocal(tw, tmp);
        if ((t.x - b.x) * b.vx + (t.y - b.y) * b.vy > 0) return;
        lingering = true;
        b.vx = Math.cos(drift) * r.lingerDrift;
        b.vy = Math.sin(drift) * r.lingerDrift;
        b.lifetime = b.age + p.linger!;
      },
    });
  }

  // --- Miasma: a cloud fills one side of the box strip by strip, holds, then clears ---------
  private planMiasma(p: ResolvedAttack): Shot[] {
    const walls: Wall[] = (['left', 'right', 'top', 'bottom'] as const).filter((w) => w !== this.lastWall);
    // Mostly from the sides (the box is wider than tall).
    const sideways = this.rng() < 0.7;
    const pool = walls.filter((w) => (w === 'left' || w === 'right') === sideways);
    const wall = (pool.length ? pool : walls)[Math.floor(this.rng() * (pool.length ? pool.length : walls.length))]!;
    this.lastWall = wall;
    const n = this.stripsFor(p, wall);
    this.clears.push(this.clearFraction(n, wall));
    const hold = (n - 1) * p.spread! + this.rules.stripForm + p.hold!;
    const shots: Shot[] = [];
    for (let k = 0; k < n; k++) {
      // Strip k appears k spreads after the first; all hold together, then they clear from the far edge back.
      const end = hold + (n - 1 - k) * p.spread! * 0.5;
      shots.push({ lead: this.rules.stripForm - k * p.spread!, fire: () => void this.strip(p, wall, k, end - k * p.spread!) });
    }
    return shots;
  }

  /** Box span across the cloud's depth (width for a side cloud, height for top/bottom). */
  private span(wall: Wall): number {
    const box = this.world.box;
    return wall === 'left' || wall === 'right' ? box.width : box.height;
  }

  /** Strips for a cloud from `wall`: the level's count, capped so at least minClear of the box stays clear. */
  stripsFor(p: ResolvedAttack, wall: Wall): number {
    const cap = Math.floor(((1 - this.rules.minClear) * this.span(wall)) / this.rules.stripWidth);
    return Math.max(1, Math.min(p.strips!, cap));
  }

  clearFraction(n: number, wall: Wall): number {
    return 1 - (n * this.rules.stripWidth) / this.span(wall);
  }

  /**
   * Strip `k` of a cloud from `wall` of the soul's box (as it is now): a solid KR rect `stripWidth`
   * deep, as long as the wall, `k` strips in from it. Gold (pre-active, harmless) for stripForm s,
   * then poison until `life` s after it appeared. Its edge is exactly its hitbox (a rect).
   */
  strip(p: ResolvedAttack, wall: Wall, k: number, life: number): Bullet | null {
    const box = this.world.box;
    const r = this.rules;
    const [nx, ny] = INWARD[wall];
    const depth = (k + 0.5) * r.stripWidth;
    const side = nx !== 0;
    return this.world.pool.spawn({
      shape: 'rect', kind: 'kr', damage: p.damage!, owner: this.id, flags: N_STRIP, flicker: r.shimmer, noShine: true,
      x: side ? -nx * (box.halfWidth - depth) : 0, y: side ? 0 : -ny * (box.halfHeight - depth),
      a: side ? r.stripWidth / 2 : box.halfWidth, b: side ? box.halfHeight : r.stripWidth / 2,
      armDelay: r.stripForm, lifetime: Math.max(r.stripForm + 0.05, life),
    });
  }

  // --- Burst: pods form gold inside the box, then burst into rings of spores ----------------
  private planBurst(p: ResolvedAttack): Shot[] {
    return [{ lead: this.formOf(p), fire: () => void this.pods(p) }];
  }

  /**
   * `count` pods inside the soul's box (as it is now), each at least podClear from the soul and apart
   * from each other, gold (pre-active, harmless) for formOf(p) s; then each bursts into a ring of
   * `ring` KR spores flying out at `speed` and the pod is gone (it never collides).
   */
  pods(p: ResolvedAttack): Bullet[] {
    const box = this.world.box;
    const r = this.rules;
    const form = this.formOf(p);
    const s = this.world.soul.pos;
    const m = r.podSize * 1.2;
    const out: Bullet[] = [];
    const at: { x: number; y: number }[] = [];
    for (let tries = 0; at.length < p.count! && tries < 80; tries++) {
      const x = (this.rng() * 2 - 1) * (box.halfWidth - m);
      const y = (this.rng() * 2 - 1) * (box.halfHeight - m);
      if (Math.hypot(x - s.x, y - s.y) < r.podClear) continue;
      if (at.some((q) => Math.hypot(q.x - x, q.y - y) < r.podSize * 4)) continue;
      at.push({ x, y });
    }
    for (const q of at) {
      const b = this.world.pool.spawn({
        shape: 'composite', form: podForm(r.podSize), a: 0, x: q.x, y: q.y, rotation: -box.rotation, kind: 'kr', damage: p.damage!,
        owner: this.id, flags: N_POD, armDelay: form, growIn: true, lifetime: form + 0.05,
        onArm: (pod: Bullet, pool) => {
          ring(pool, { x: pod.x, y: pod.y, count: p.ring!, speed: p.speed!, radius: r.podSize, angleOffset: this.rng() * Math.PI, style: this.sporeStyle(p, N_RING) });
          this.world.pool.release(pod, 'cancel');
        },
      });
      if (b) out.push(b);
    }
    return out;
  }

  // --- Debug sandbox: shots keep their own timing (strips, drifts) --------------------------
  private devQueue: { at: number; fire: () => void }[] = [];

  override fireNow(id: NightshadeAttack, level = this.level): boolean {
    const p = resolveLevel(this.config, level).attacks[id];
    if (!p) return false;
    const shots = this.attacks[id](p);
    const need = Math.max(...shots.map((x) => x.lead));
    for (const x of shots) this.devQueue.push({ at: this.clock + need - x.lead, fire: x.fire });
    this.runDevQueue();
    this.world.bus.emit('attackStarted', { owner: this.id, attack: id });
    return true;
  }

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
