import { Character, type Shot } from '../Character';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { ResolvedAttack } from '../config';
import type { Bullet, Wall } from '../../combat/Bullet';
import { pointInTriangle, type Triangle } from '../../combat/Collision';
import { bulletExtent } from '../../combat/Bullet';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { aabbInBand, bulletWorldAabb, type Aabb } from '../../combat/bands';
import { propTriangle, type Prop } from '../../core/World';
import { hud, theme, VIEW } from '../../render/theme';
import { SCREEN_HEIGHT, SCREEN_WIDTH, px } from '../../tuning';
import type { LookSpec } from '../Character';
import { emitterForm, mirrorForm, prismConfig, type PrismAttack, type PrismPhase, type PrismRules } from './prism.config';
import { mirrorAngle, pathLength, pointAt, screenExitDistance, type Pt } from './mirrorPath';

export type PrismPhaseState = PhaseState<PrismPhase>;

/** Bullet flag: this beam came out of a refraction prism and ignores prisms from now on. */
export const REFRACTED = 1;
/** Bullet flag: Prism's mirror beam (never refracts). */
export const MIRROR_BEAM = 2;

const EDGES: Wall[] = ['left', 'right', 'top', 'bottom'];
/** Inward unit normal for each edge. */
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };
const OPPOSITE: Record<Wall, Wall> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** A planned mirror volley: random choices made when it is planned, geometry worked out when it forms. */
interface MirrorPlan {
  sides: Wall[];
  /** Along each mirror's wall, -1..1 of the half length. */
  u: number[];
  /** Entry angle off the first wall's inward normal (rad). */
  entry: number;
  /** Where the last leg aims inside the box, -1..1 of the half extents. */
  exit: [number, number];
}

/** The world-space geometry of a mirror volley: the beam's polyline and each mirror (center + surface angle). */
export interface MirrorGeometry {
  path: Pt[];
  mirrors: { x: number; y: number; angle: number }[];
}

export class Prism extends Character<PrismAttack, PrismRules> {
  readonly id = 'prism';
  readonly color = theme.prism;
  readonly config = prismConfig;
  protected readonly attacks = {
    beam: (p: ResolvedAttack) => this.planBeams(p),
    prism: (p: ResolvedAttack) => this.relocatePrism(p),
    mirrors: (p: ResolvedAttack) => this.planMirrors(p),
    blaster: (p: ResolvedAttack) => this.planBlaster(p),
  };

  /** Beams start off screen; plan them early enough to still arrive on the beat. */
  protected override planAhead(id: PrismAttack, p: ResolvedAttack): number {
    if (id === 'prism') return 0;
    if (id === 'blaster') return this.warnOf(p);
    if (id === 'mirrors') return p.read! + maxOffscreenDistance(this.world.box, 0) / p.speed! + this.world.home.width / p.speed!;
    const extent = bulletExtent({ shape: 'beam', a: p.length!, b: this.rules.beamThickness });
    return maxOffscreenDistance(this.world.box, extent) / p.speed!;
  }

  /** Rays (with their glow), the refraction prism, mirrors and their beam, emitters, warning lines and lasers at this level. */
  override lookSpecs(): LookSpec[] {
    const r = this.rules;
    const out: LookSpec[] = [];
    const at = this.resolved.attacks;
    if (at.beam) out.push({ shape: 'beam', a: at.beam.length!, b: r.beamThickness, glow: true });
    out.push({ prop: r.prismRadius });
    if (at.mirrors) {
      out.push({ shape: 'beam', a: at.mirrors.length!, b: r.beamThickness, glow: true });
      out.push({ shape: 'composite', form: mirrorForm(r.mirrorSize, r.mirrorThickness), decor: true });
    }
    if (at.blaster) {
      out.push({ shape: 'rect', a: r.laserLength / 2, b: r.warnThickness / 2 });
      out.push({ shape: 'rect', a: r.laserLength / 2, b: r.laserThickness / 2, glow: true });
      out.push({ shape: 'composite', form: emitterForm(r.emitterSize), decor: true });
    }
    return out;
  }

  /** The refraction prism: shown from the breather before a ray phase until that phase ends. */
  prop: Prop | null = null;
  /** Own-clock time the prism was last placed (relocation waits a full cooldown). */
  private placedAt = -Infinity;
  /** Phase as of the last step ('' until the first tick). */
  phase: PrismPhase | 'breather' | '' = '';

  /** Phase order at this level: only phases with an unlocked attack (no empty phases). */
  get order(): readonly PrismPhase[] {
    const at = this.resolved.attacks;
    return this.rules.phaseOrder.filter((ph) => (Object.keys(at) as PrismAttack[]).some((id) => this.rules.attackPhase[id] === ph));
  }

  /** The phase at own-clock time `t`: each unlocked phase for phaseLength s, then a breather before the next. */
  phaseAt(t: number): PrismPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  /** Arrivals only inside the attack's own phase window (mirror and blaster volleys must also finish in it). */
  protected override nextArrival(id: PrismAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    if (p && id === 'mirrors') tail = this.mirrorTail(p);
    if (p && id === 'blaster') tail = (p.count! - 1) * p.stagger! + this.rules.laserTime;
    return nextPhaseArrival(this.rules, this.order, this.rules.attackPhase[id], at, tail);
  }

  /** Refraction runs at phaseIntensity x its band's rate; mirrors and blasters at their band's rate. */
  protected override cooldownOf(id: PrismAttack, p: ResolvedAttack): number {
    return id === 'beam' || id === 'prism' ? p.cooldown! / this.rules.phaseIntensity : p.cooldown!;
  }
  private readonly tri: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };
  /** Ray plans so far (the first is the pre-fired opening). */
  private beamPlans = 0;

  private get rules(): PrismRules {
    return this.config.rules;
  }

  // --- Ray phase: beams from off screen; they only multiply through the prism --
  /**
   * Each beam crosses a random point on a random box edge (up to +-20 degrees off the inward normal,
   * or aimed through the prism), starting off screen on that line.
   */
  private planBeams(p: ResolvedAttack): Shot[] {

    const prismP = this.resolved.attacks.prism;
    const extent = bulletExtent({ shape: 'beam', a: p.length!, b: this.rules.beamThickness });
    const shots: Shot[] = [];
    // The opening rays are pre-fired (they appear part way in): from a side, near the middle of the
    // wall, close to the normal and not aimed through the prism, so they appear beside the box and
    // never in a HUD band (a top/bottom or steep ray would).
    const opening = this.beamPlans++ === 0;
    for (let i = 0; i < p.count!; i++) {
      let edge = opening ? (this.rng() < 0.5 ? 'left' : 'right') : EDGES[Math.floor(this.rng() * 4)]!;
      const u = (this.rng() * 1.6 - 0.8) * (opening ? 0.6 : 1); // position along the edge, of half length
      const jitter = (this.rng() - 0.5) * (opening ? 0.3 : 0.7);
      const aimed = !opening && !!(prismP && this.rng() < prismP.aimChance!) && this.prop !== null;
      // Aimed rays enter through the wall facing the prism (which stands outside the box).
      if (aimed) edge = this.prop!.x < 0 ? 'left' : 'right';
      // The path is worked out against the box as it is now (for the lead) and again when the ray
      // spawns, so it still crosses the box (and the prism) if the box was shoved or turned meanwhile.
      const path = () => {
        const box = this.world.box;
        const [nx, ny] = INWARD[edge];
        const ex = nx !== 0 ? -nx * box.halfWidth : u * box.halfWidth;
        const ey = ny !== 0 ? -ny * box.halfHeight : u * box.halfHeight;
        let angle = jitter + Math.atan2(ny, nx);
        // Aimed: the ray's line runs from off screen through the prism to the wall point, so it
        // refracts (fans into three) before entering the box. Otherwise from off screen to the wall point.
        let start = offscreenStart(box, ex, ey, angle, extent);
        let toBox = start.distance;
        const P = aimed ? this.prop : null;
        if (P) {
          angle = Math.atan2(ey - P.y, ex - P.x);
          start = offscreenStart(box, P.x, P.y, angle, extent);
          toBox = start.distance + Math.hypot(ex - P.x, ey - P.y);
        }
        return { start, angle, toBox };
      };
      shots.push({
        lead: path().toBox / p.speed!,
        fire: () => {
          const { start, angle } = path();
          this.spawnBeam(start.x, start.y, angle, p.speed!, p, 0, 0, true);
        },
      });
    }
    return shots;
  }

  private spawnBeam(x: number, y: number, angle: number, speed: number, p: ResolvedAttack, gen: number, flags: number, child: boolean): void {
    // White, and no wall hook: rays never split; they only multiply through the refraction prism.
    const b = this.world.pool.spawn({
      shape: 'beam', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, faceVelocity: true,
      a: p.length!, b: this.rules.beamThickness, damage: p.damage!, owner: this.id, kind: 'white',
      gen, flags, noPop: child, glow: true,
    });
    if (b) this.world.bus.emit('beamFired', { owner: this.id, x, y, angle, gen });
  }

  // --- Ray phase: refraction prism ------------------------------------------
  /** The 'prism' attack: relocate, once the prism has stood a full (phase) cooldown. */
  private relocatePrism(p: ResolvedAttack): null | void {
    if (!this.prop || this.clock - this.placedAt < this.cooldownOf('prism', p) - 1e-9) return null;
    this.placePrism();
  }

  private placePrism(): void {
    const { box } = this.world;
    this.placedAt = this.clock;
    const r = this.rules.prismRadius;
    if (!this.prop) {
      this.prop = { shape: 'triangle', x: 0, y: 0, r, rotation: 0, color: theme.prismProp, refracts: true };
      this.world.props.push(this.prop);
    }
    // Outside the box, beside its left or right wall, inside the screen and clear of the HUD bands
    // (theme.hud), where aimed rays pass on their way in. Chosen and kept in WORLD space (like
    // bullets, it stays put when the box is shoved or turned); the prop's box-local copy follows.
    // If the box is displaced so one side has no room, the other side is used.
    const first = this.rng() < 0.5 ? -1 : 1;
    const gap = r + this.rules.prismGap;
    const spread = this.rng() * this.rules.prismSpread;
    const margin = r + px(6);
    const ext = this.boxExtent();
    let x = 0;
    for (const side of [first, -first]) {
      const wx = box.x + side * (ext.hx + gap + spread);
      x = Math.max(margin, Math.min(VIEW.width - margin, wx));
      if (Math.abs(x - box.x) >= ext.hx + r) break;
    }
    const yMin = Math.max(hud.top.y + hud.top.height + margin, box.y - ext.hy);
    const yMax = Math.min(hud.bottom.y - margin, box.y + ext.hy);
    const y = yMin + this.rng() * Math.max(0, yMax - yMin);
    this.propWorld = { x, y, rotation: this.rng() * Math.PI * 2 };
    this.syncProp();
  }

  /** World-space placement of the prism (it never rides the box). */
  private propWorld = { x: 0, y: 0, rotation: 0 };

  /** Half extents of the box's rotated outline in world space. */
  private boxExtent(): { hx: number; hy: number } {
    const { box } = this.world;
    const c = Math.abs(Math.cos(box.rotation)), s = Math.abs(Math.sin(box.rotation));
    return { hx: box.halfWidth * c + box.halfHeight * s, hy: box.halfWidth * s + box.halfHeight * c };
  }

  /** Re-express the world-fixed prism in the box's current frame. */
  private syncProp(): void {
    if (!this.prop) return;
    const { box } = this.world;
    const l = box.toLocal(this.propWorld);
    this.prop.x = l.x;
    this.prop.y = l.y;
    this.prop.rotation = this.propWorld.rotation - box.rotation;
  }

  /** Whether any box (shoved or ripped apart by another character) now covers part of the prism. */
  private propOverlapsBox(): boolean {
    const r = this.prop!.r;
    return this.world.boxes.some((box) => {
      const l = box.toLocal(this.propWorld);
      return Math.abs(l.x) < box.halfWidth + r && Math.abs(l.y) < box.halfHeight + r;
    });
  }

  /** Any of our beams whose center enters the prism fans into refractCount beams that ignore prisms. */
  protected override update(): void {
    // Phase bookkeeping: event on every change; the prism shows from the breather before a ray
    // phase (a telegraph) until the ray phase ends.
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('prismPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
    if (st.next === 'ray' && !this.prop) {
      this.placePrism();
    } else if (st.next !== 'ray' && this.prop) {
      this.removePrism();
    }
    // The prism is world-fixed: follow the box frame, and step aside if the box was pushed onto it.
    if (this.prop) {
      this.syncProp();
      if (this.propOverlapsBox()) this.placePrism();
    }
    const prop = this.prop;
    const pp = this.resolved.attacks.prism;
    const bp = this.resolved.attacks.beam;
    if (!prop || !pp || !bp) return;
    const tri = propTriangle(prop, this.tri);
    const n = this.rules.refractCount;
    for (const b of this.world.pool.all) {
      if (!b.active || b.owner !== this.id || b.shape !== 'beam' || b.flags & (REFRACTED | MIRROR_BEAM)) continue;
      if (!pointInTriangle(b.x, b.y, tri)) continue;
      const angle = Math.atan2(b.vy, b.vx);
      const speed = Math.hypot(b.vx, b.vy);
      const { x, y, gen } = b;
      const flags = b.flags | REFRACTED;
      this.world.pool.release(b, 'cleared');
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        this.spawnBeam(x, y, angle + t * pp.refractSpread!, speed, bp, gen + 1, flags, true);
      }
      this.world.bus.emit('beamRefracted', { owner: this.id, x, y, count: n });
    }
  }

  // --- Mirrors: mirrors form gold around the box, then one beam ricochets through all of them ---
  /** Mirror volleys skipped because a mirror would sit off screen or in a HUD band (a far-displaced box). */
  skippedMirrors = 0;
  /** Blaster emitters skipped for the same reason. */
  skippedBlasters = 0;

  /** Seconds a mirror volley keeps crossing after its beam first enters the box (closes its window early). */
  private mirrorTail(p: ResolvedAttack): number {
    const h = this.world.home;
    const leg = Math.hypot(h.width, h.height) + 2 * this.rules.mirrorGap;
    return ((p.count! - 1) * leg + Math.hypot(SCREEN_WIDTH, SCREEN_HEIGHT) / 2) / p.speed!;
  }

  /** Random choices for a volley of `n` mirrors: one axis (left/right or top/bottom), alternating sides. */
  private mirrorPlan(n: number): MirrorPlan {
    const sideways = this.rng() < this.rules.mirrorSideways;
    const [a, b]: [Wall, Wall] = sideways ? ['left', 'right'] : ['top', 'bottom'];
    let side: Wall = this.rng() < 0.5 ? a : b;
    const sides: Wall[] = [];
    const u: number[] = [];
    for (let i = 0; i < n; i++) {
      sides.push(side);
      u.push((this.rng() * 2 - 1) * 0.8);
      side = OPPOSITE[side];
    }
    return { sides, u, entry: (this.rng() - 0.5) * 0.8, exit: [(this.rng() * 2 - 1) * 0.5, (this.rng() * 2 - 1) * 0.5] };
  }

  /**
   * The volley's world geometry against the soul's box as it is now: each mirror `mirrorGap` outside
   * its wall, the beam's polyline from off screen through every mirror's center (consecutive mirrors
   * sit on opposite walls, so every leg between them crosses the box) and out through the box to off
   * screen, and each mirror turned to reflect its incoming leg into its outgoing one.
   */
  mirrorGeometry(plan: MirrorPlan, length: number): MirrorGeometry {
    const r = this.rules;
    const box = this.world.box;
    const ms: Pt[] = plan.sides.map((side, i) => {
      const [nx, ny] = INWARD[side];
      const local = nx !== 0
        ? { x: -nx * (box.halfWidth + r.mirrorGap), y: plan.u[i]! * box.halfHeight }
        : { x: plan.u[i]! * box.halfWidth, y: -ny * (box.halfHeight + r.mirrorGap) };
      return box.toWorld(local, { x: 0, y: 0 });
    });
    const margin = length + r.beamThickness;
    const [nx, ny] = INWARD[plan.sides[0]!];
    const ea = Math.atan2(ny, nx) + plan.entry + box.rotation;
    const dx = Math.cos(ea), dy = Math.sin(ea);
    const m0 = ms[0]!;
    const back = screenExitDistance(m0.x, m0.y, -dx, -dy, margin);
    const start = { x: m0.x - dx * back, y: m0.y - dy * back };
    const last = ms[ms.length - 1]!;
    const target = box.toWorld({ x: plan.exit[0] * box.halfWidth, y: plan.exit[1] * box.halfHeight }, { x: 0, y: 0 });
    const tl = Math.hypot(target.x - last.x, target.y - last.y) || 1;
    const ox = (target.x - last.x) / tl, oy = (target.y - last.y) / tl;
    const out = screenExitDistance(last.x, last.y, ox, oy, margin);
    const path = [start, ...ms, { x: last.x + ox * out, y: last.y + oy * out }];
    return { path, mirrors: ms.map((m, i) => ({ x: m.x, y: m.y, angle: mirrorAngle(path[i]!, m, path[i + 2]!) })) };
  }

  /** Distance along the path to where the beam first enters the soul's box (its arrival). */
  private entryDistance(path: readonly Pt[]): number {
    const box = this.world.box;
    const L = pathLength(path);
    const tmp = { x: 0, y: 0 };
    for (let s = 0; s <= L; s += 0.5) {
      const q = pointAt(path, s);
      const l = box.toLocal(q, tmp);
      if (Math.abs(l.x) <= box.halfWidth && Math.abs(l.y) <= box.halfHeight) return s;
    }
    return L;
  }

  /** Whether every mirror (its full length, any angle) is on screen and clear of the HUD bands. */
  private mirrorsClear(g: MirrorGeometry): boolean {
    const s = this.rules.mirrorSize + this.rules.mirrorThickness * 2;
    return g.mirrors.every((m) => this.clearOfBands({ x0: m.x - s, y0: m.y - s, x1: m.x + s, y1: m.y + s }));
  }

  private clearOfBands(a: Aabb): boolean {
    return !aabbInBand(a) && a.x0 >= 0 && a.x1 <= SCREEN_WIDTH && a.y0 >= 0 && a.y1 <= SCREEN_HEIGHT;
  }

  private planMirrors(p: ResolvedAttack): Shot[] {
    const plan = this.mirrorPlan(p.count!);
    const g = this.mirrorGeometry(plan, p.length!);
    // Arrival: the beam first enters the box (after the read time and the leg in from off screen).
    return [{ lead: p.read! + this.entryDistance(g.path) / p.speed!, fire: () => void this.formMirrors(p, plan) }];
  }

  /**
   * A mirror volley, worked out against the soul's box now: the mirrors appear gold (decor, harmless)
   * for `read` s so the path can be read, then the beam fires from off screen and follows the path,
   * bouncing off each mirror in turn; each mirror turns light violet once the beam is on its way.
   * Skipped if a mirror would sit off screen or in a HUD band. Returns the geometry it used.
   */
  formMirrors(p: ResolvedAttack, plan: MirrorPlan = this.mirrorPlan(p.count!)): MirrorGeometry | null {
    const g = this.mirrorGeometry(plan, p.length!);
    if (!this.mirrorsClear(g)) {
      this.skippedMirrors++;
      return null;
    }
    const r = this.rules;
    const read = p.read!;
    const box = this.world.box;
    const form = mirrorForm(r.mirrorSize, r.mirrorThickness);
    let reach = 0;
    let fired = false;
    g.mirrors.forEach((m, i) => {
      reach += Math.hypot(g.path[i + 1]!.x - g.path[i]!.x, g.path[i + 1]!.y - g.path[i]!.y);
      const local = box.toLocal(m, { x: 0, y: 0 });
      this.world.pool.spawn({
        shape: 'composite', form, a: 0, x: local.x, y: local.y, rotation: m.angle - box.rotation, damage: 0, owner: this.id,
        decor: true, tint: theme.preActive, edgeTint: theme.bullet.white, lifetime: read + reach / p.speed! + 0.25,
        onStep: (b: Bullet) => {
          if (b.age < read - 1e-9) return;
          b.tint = theme.prismProp;
          if (i === 0 && !fired) {
            fired = true;
            this.spawnMirrorBeam(p, g.path);
          }
        },
      });
    });
    return g;
  }

  /**
   * The mirror beam: a white light beam (solid core = hitbox, decorative glow) whose position is the
   * point `(world time since it fired) x speed` along the path (world time, so it doesn't matter
   * whether the pool moves it in the step it spawns). Each step its velocity is set along the current
   * leg so the pool's move lands it exactly on the path; the path is world space, so the beam stays
   * world-fixed.
   */
  private spawnMirrorBeam(p: ResolvedAttack, path: readonly Pt[]): Bullet | null {
    const speed = p.speed!;
    const box0 = this.world.box;
    const q0 = pointAt(path, 0);
    const l0 = box0.toLocal(q0, { x: 0, y: 0 });
    const tmp = { x: 0, y: 0 };
    const t0 = this.world.time;
    return this.world.pool.spawn({
      shape: 'beam', x: l0.x, y: l0.y, rotation: Math.atan2(q0.dy, q0.dx) - box0.rotation, a: p.length!, b: this.rules.beamThickness,
      damage: p.damage!, owner: this.id, kind: 'white', glow: true, noPop: true, flags: MIRROR_BEAM,
      lifetime: pathLength(path) / speed,
      onStep: (b: Bullet, dt: number) => {
        const box = this.world.box;
        const q = pointAt(path, (this.world.time - t0) * speed);
        tmp.x = q.x - q.dx * speed * dt;
        tmp.y = q.y - q.dy * speed * dt;
        const l = box.toLocal(tmp, tmp);
        b.x = l.x;
        b.y = l.y;
        const c = Math.cos(box.rotation), s = Math.sin(box.rotation);
        const lx = q.dx * c + q.dy * s, ly = -q.dx * s + q.dy * c;
        b.vx = lx * speed;
        b.vy = ly * speed;
        b.rotation = Math.atan2(ly, lx);
      },
    });
  }

  // --- Blaster: emitters beside the box show a thin warning line, then fire a thick laser -----
  /** The warning time at this level, never below rules.minWarn. */
  warnOf(p: ResolvedAttack): number {
    return Math.max(this.rules.minWarn, p.warn!);
  }

  private planBlaster(p: ResolvedAttack): Shot[] {
    const warn = this.warnOf(p);
    const shots: Shot[] = [];
    for (let k = 0; k < p.count!; k++) {
      const side: Wall = this.rng() < 0.5 ? 'left' : 'right';
      const u = (this.rng() * 2 - 1) * 0.7;
      const aim: [number, number] = [(this.rng() * 2 - 1) * 0.4, (this.rng() * 2 - 1) * 0.6];
      // Emitters fire one after another, `stagger` s apart (back to back at high levels).
      shots.push({ lead: warn - k * p.stagger!, fire: () => void this.blast(p, side, u, aim) });
    }
    return shots;
  }

  /**
   * One emitter (decor) `emitterGap` outside the left or right wall of the soul's box, aimed through
   * the box, and its laser: one rect bullet from the emitter's mouth through the box. Pre-active
   * (gold, never collides) and thin for the warning time, it is the warning line, exactly on the
   * laser's path; when it arms it becomes the thick white laser (onArm) and collides for laserTime s,
   * then it is gone. The aim is kept within laserMaxAngle of horizontal and so that the whole line
   * stays between the HUD bands. Skipped if the emitter would be off screen or in a band.
   */
  blast(p: ResolvedAttack, side: Wall, u: number, aim: [number, number]): { emitter: Bullet; laser: Bullet } | null {
    const r = this.rules;
    const box = this.world.box;
    const warn = this.warnOf(p);
    const [nx] = INWARD[side];
    const e = box.toWorld({ x: -nx * (box.halfWidth + r.emitterGap), y: u * box.halfHeight }, { x: 0, y: 0 });
    const t = box.toWorld({ x: aim[0] * box.halfWidth, y: aim[1] * box.halfHeight }, { x: 0, y: 0 });
    const len = r.emitterSize + r.laserLength;
    const m = r.laserThickness / 2 + 2;
    const PLAY_TOP = hud.top.y + hud.top.height, PLAY_BOTTOM = hud.bottom.y;
    const toward = Math.sign(t.x - e.x) || nx;
    let sin = Math.sin(Math.atan2(t.y - e.y, t.x - e.x));
    const maxSin = Math.sin(r.laserMaxAngle);
    sin = Math.max(-maxSin, Math.min(maxSin, sin));
    // The far end stays between the bands (y grows downward).
    sin = Math.max(-(e.y - (PLAY_TOP + m)) / len, Math.min(((PLAY_BOTTOM - m) - e.y) / len, sin));
    const ang = Math.atan2(sin, toward * Math.sqrt(Math.max(0, 1 - sin * sin)));
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const s = r.emitterSize * 1.1;
    if (!this.clearOfBands({ x0: e.x - s, y0: e.y - s, x1: e.x + s, y1: e.y + s })) {
      this.skippedBlasters++;
      return null;
    }
    const el = box.toLocal(e, { x: 0, y: 0 });
    const c = box.toLocal({ x: e.x + dx * (r.emitterSize + r.laserLength / 2), y: e.y + dy * (r.emitterSize + r.laserLength / 2) }, { x: 0, y: 0 });
    const rot = ang - box.rotation;
    const emitter = this.world.pool.spawn({
      shape: 'composite', form: emitterForm(r.emitterSize), a: 0, x: el.x, y: el.y, rotation: rot, damage: 0, owner: this.id,
      decor: true, tint: theme.prismProp, edgeTint: theme.bullet.white, lifetime: warn + r.laserTime + 0.05,
    });
    if (!emitter) return null;
    const laser = this.world.pool.spawn({
      shape: 'rect', x: c.x, y: c.y, rotation: rot, a: r.laserLength / 2, b: r.warnThickness / 2,
      damage: p.damage!, owner: this.id, kind: 'white', noPop: true, noShine: true,
      armDelay: warn, lifetime: warn + r.laserTime,
      onArm: (b: Bullet) => {
        b.b = r.laserThickness / 2;
        b.glow = true;
      },
    });
    if (!laser) {
      this.world.pool.release(emitter, 'cancel');
      return null;
    }
    // The whole line (any part on screen) must stay out of the bands; never expected to trigger.
    const a = bulletWorldAabb(box, laser);
    if (aabbInBand({ x0: Math.max(0, a.x0), x1: Math.min(SCREEN_WIDTH, a.x1), y0: a.y0, y1: a.y1 })) {
      this.world.pool.release(emitter, 'cancel');
      this.world.pool.release(laser, 'cancel');
      this.skippedBlasters++;
      return null;
    }
    return { emitter, laser };
  }

  protected override onLevelChanged(): void {
    if (!this.active) this.removePrism();
  }

  private removePrism(): void {
    if (!this.prop) return;
    const i = this.world.props.indexOf(this.prop);
    if (i >= 0) this.world.props.splice(i, 1);
    this.prop = null;
  }

  override dispose(): void {
    this.removePrism();
  }
}
