import { Character, type Shot } from '../Character';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { ResolvedAttack } from '../config';
import type { Wall } from '../../combat/Bullet';
import { pointInTriangle, type Triangle } from '../../combat/Collision';
import { bulletExtent } from '../../combat/Bullet';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { propTriangle, type Prop } from '../../core/World';
import { hud, theme, VIEW } from '../../render/theme';
import { px } from '../../tuning';
import type { LookSpec } from '../Character';
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
    beam: (p: ResolvedAttack) => this.planBeams(p),
    prism: (p: ResolvedAttack) => this.relocatePrism(p),
  };

  /** Beams start off screen; plan them early enough to still arrive on the beat. */
  protected override planAhead(id: PrismAttack, p: ResolvedAttack): number {
    if (id === 'prism' || !p.speed) return 0;
    const extent = bulletExtent({ shape: 'beam', a: p.length!, b: this.rules.beamThickness });
    return maxOffscreenDistance(this.world.box, extent) / p.speed;
  }

  /** Rays (with their glow) and the refraction prism at this level. */
  override lookSpecs(): LookSpec[] {
    const out: LookSpec[] = [];
    const beam = this.resolved.attacks.beam;
    if (beam) out.push({ shape: 'beam', a: beam.length!, b: this.rules.beamThickness, glow: true });
    out.push({ prop: this.rules.prismRadius });
    return out;
  }

  /** The refraction prism: shown from the breather before a ray phase until that phase ends. */
  prop: Prop | null = null;
  /** Own-clock time the prism was last placed (relocation waits a full cooldown). */
  private placedAt = -Infinity;
  /** Phase as of the last step ('' until the first tick). */
  phase: PrismPhase | 'breather' | '' = '';

  /** The phase at own-clock time `t`: rest/ray for phaseLength s, then a breather before the next. */
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
  private readonly tri: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };

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
    for (let i = 0; i < p.count!; i++) {
      let edge = EDGES[Math.floor(this.rng() * 4)]!;
      const u = this.rng() * 1.6 - 0.8; // position along the edge, -0.8..0.8 of half length
      const jitter = (this.rng() - 0.5) * 0.7;
      const aimed = !!(prismP && this.rng() < prismP.aimChance!) && this.prop !== null;
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
