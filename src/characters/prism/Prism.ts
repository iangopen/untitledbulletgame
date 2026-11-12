import { Character, type Shot } from '../Character';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { ResolvedAttack } from '../config';
import type { Wall } from '../../combat/Bullet';
import { pointInTriangle, type Triangle } from '../../combat/Collision';
import { line, lineOffset } from '../../combat/patterns';
import { bulletExtent } from '../../combat/Bullet';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { propTriangle, type Prop } from '../../core/World';
import { hud, theme, VIEW } from '../../render/theme';
import { px } from '../../tuning';
import { prismConfig, type PrismAttack, type PrismPhase, type PrismRules } from './prism.config';

export type PrismPhaseState = PhaseState<PrismPhase>;

/** Bullet flag: this beam came out of a refraction prism and ignores prisms from now on. */
export const REFRACTED = 1;

const EDGES: Wall[] = ['left', 'right', 'top', 'bottom'];
/** Inward unit normal for each edge. */
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

export class Prism extends Character<PrismAttack, PrismRules> {
  readonly id = 'prism';
  readonly color = theme.prism;
  readonly config = prismConfig;
  protected readonly attacks = {
    volley: (p: ResolvedAttack) => this.planVolley(p),
    beam: (p: ResolvedAttack) => this.planBeams(p),
    prism: (p: ResolvedAttack) => this.relocatePrism(p),
  };

  /** Volleys and beams start off screen; plan them early enough to still arrive on the beat. */
  protected override planAhead(id: PrismAttack, p: ResolvedAttack): number {
    if (id === 'prism' || !p.speed) return 0;
    const extent = id === 'volley' ? this.rules.volleySize : bulletExtent({ shape: 'beam', a: p.length!, b: this.rules.beamThickness });
    return maxOffscreenDistance(this.world.box, extent) / p.speed;
  }

  /** The refraction prism: shown from the breather before a ray phase until that phase ends. */
  prop: Prop | null = null;
  /** Own-clock time the prism was last placed (relocation waits a full cooldown). */
  private placedAt = -Infinity;
  /** Phase as of the last step ('' until the first tick). */
  phase: PrismPhase | 'breather' | '' = '';

  /** The phase at own-clock time `t`: wall/ray for phaseLength s, then a breather before the next. */
  phaseAt(t: number): PrismPhaseState {
    return phaseAt(this.rules, this.rules.phaseOrder, t);
  }

  /** Arrivals only inside the attack's own phase window. */
  protected override nextArrival(id: PrismAttack, at: number): number {
    return nextPhaseArrival(this.rules, this.rules.phaseOrder, this.rules.attackPhase[id], at);
  }

  /** phaseIntensity x the band's rate inside each phase. */
  protected override cooldownOf(_id: PrismAttack, p: ResolvedAttack): number {
    return p.cooldown! / this.rules.phaseIntensity;
  }
  private lastEdge: Wall | null = null;
  private readonly tri: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };

  private get rules(): PrismRules {
    return this.config.rules;
  }

  private pickEdge(): Wall {
    let e: Wall;
    do e = EDGES[Math.floor(this.rng() * 4)]!;
    while (e === this.lastEdge);
    this.lastEdge = e;
    return e;
  }

  // --- Levels 1+: triangle volleys from one edge, constant spacing, one safe gap --
  private planVolley(p: ResolvedAttack): Shot[] {
    const edge = this.pickEdge();
    const gapAt = this.rng();
    const style = {
      shape: 'triangle' as const, a: this.rules.volleySize, faceVelocity: true, noPop: true,
      damage: p.damage!, owner: this.id, kind: 'white' as const,
    };
    const { box, pool } = this.world;
    // The row starts just off screen; it reaches the box edge after offset / speed seconds.
    const lead = lineOffset(box, { edge, style }) / p.speed!;
    return [{
      lead,
      fire: () => {
        line(pool, box, { edge, spacing: this.rules.volleySpacing, speed: p.speed!, gapSize: p.gapSize!, gapAt, style });
      },
    }];
  }

  // --- Ray phase: beams from off screen; they only multiply through the prism --
  /**
   * Each beam crosses a random point on a random box edge (up to +-20 degrees off the inward normal,
   * or aimed through the prism), starting off screen on that line.
   */
  private planBeams(p: ResolvedAttack): Shot[] {
    const { box } = this.world;
    const prismP = this.resolved.attacks.prism;
    const extent = bulletExtent({ shape: 'beam', a: p.length!, b: this.rules.beamThickness });
    const shots: Shot[] = [];
    for (let i = 0; i < p.count!; i++) {
      let edge = EDGES[Math.floor(this.rng() * 4)]!;
      const u = this.rng() * 1.6 - 0.8; // position along the edge, -0.8..0.8 of half length
      let angle = (this.rng() - 0.5) * 0.7;
      const aimed = !!(prismP && this.rng() < prismP.aimChance!) && this.prop !== null;
      // Aimed rays enter through the wall facing the prism (which stands outside the box).
      if (aimed) edge = this.prop!.x < 0 ? 'left' : 'right';
      const [nx, ny] = INWARD[edge];
      const ex = nx !== 0 ? -nx * box.halfWidth : u * box.halfWidth;
      const ey = ny !== 0 ? -ny * box.halfHeight : u * box.halfHeight;
      angle += Math.atan2(ny, nx);
      // Aimed: the ray's line runs from off screen through the prism to the wall point, so it
      // refracts (fans into three) before entering the box. Otherwise from off screen to the wall point.
      let start = offscreenStart(box, ex, ey, angle, extent);
      let toBox = start.distance;
      if (aimed) {
        const P = this.prop!;
        angle = Math.atan2(ey - P.y, ex - P.x);
        start = offscreenStart(box, P.x, P.y, angle, extent);
        toBox = start.distance + Math.hypot(ex - P.x, ey - P.y);
      }
      const a = angle;
      const s = start;
      shots.push({ lead: toBox / p.speed!, fire: () => this.spawnBeam(s.x, s.y, a, p.speed!, p, 0, 0, true) });
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
      this.prop = { shape: 'triangle', x: 0, y: 0, r, rotation: 0, color: this.color, refracts: true };
      this.world.props.push(this.prop);
    }
    // Outside the box, beside its left or right wall, inside the screen and clear of the HUD bands
    // (theme.hud), where aimed rays pass on their way in. Chosen in world space, stored box-local.
    const side = this.rng() < 0.5 ? -1 : 1;
    const gap = r + this.rules.prismGap;
    const wx0 = box.x + side * (box.halfWidth + gap);
    const wx = wx0 + side * this.rng() * this.rules.prismSpread;
    const margin = r + px(6);
    const x = Math.max(margin, Math.min(VIEW.width - margin, wx));
    const yMin = Math.max(hud.top.y + hud.top.height + margin, box.y - box.halfHeight);
    const yMax = Math.min(hud.bottom.y - margin, box.y + box.halfHeight);
    const y = yMin + this.rng() * Math.max(0, yMax - yMin);
    const local = box.toLocal({ x, y });
    this.prop.x = local.x;
    this.prop.y = local.y;
    this.prop.rotation = this.rng() * Math.PI * 2;
  }


  /** Any of our beams whose center enters the prism fans into refractCount beams that ignore prisms. */
  protected override update(): void {
    // Phase bookkeeping: event on every change; the prism shows from the breather before a ray
    // phase (a telegraph) until the ray phase ends.
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
    const prop = this.prop;
    const pp = this.resolved.attacks.prism;
    const bp = this.resolved.attacks.beam;
    if (!prop || !pp || !bp) return;
    const tri = propTriangle(prop, this.tri);
    const n = this.rules.refractCount;
    for (const b of this.world.pool.all) {
      if (!b.active || b.owner !== this.id || b.shape !== 'beam' || b.flags & REFRACTED) continue;
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
