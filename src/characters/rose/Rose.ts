import { Character, type LookSpec, type Shot } from '../Character';
import type { ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import { bulletExtent, type Bullet, type Wall } from '../../combat/Bullet';
import { line, lineOffset, ring, type BulletStyle } from '../../combat/patterns';
import { maxOffscreenDistance, offscreenStart } from '../../combat/offscreen';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { theme } from '../../render/theme';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';
import { roseConfig, roseForm, thornForm, vineForm, vineWidth, type RoseAttack, type RosePhase, type RoseRules } from './rose.config';

export type RosePhaseState = PhaseState<RosePhase>;

const EDGES: Wall[] = ['left', 'right', 'top', 'bottom'];
/** Inward unit normal for each edge. */
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

/**
 * Rose: thorn volleys (the old Prism edge volleys, unchanged), vine lashes and blooms. Every
 * projectile is white. Volleys keep the old Prism's wall-phase windows (even phase slots); the
 * unlocked off-beat attacks take the odd slots (see rose.config.ts).
 */
export class Rose extends Character<RoseAttack, RoseRules> {
  readonly id = 'rose';
  readonly color = theme.rose;
  readonly config = roseConfig;
  protected readonly attacks = {
    volley: (p: ResolvedAttack) => this.planVolley(p),
    vine: (p: ResolvedAttack) => this.planVine(p),
    bloom: (p: ResolvedAttack) => this.planBloom(p),
  };
  /** Phase as of the last step ('' until the first tick). */
  phase: RosePhase | 'breather' | '' = '';
  private lastEdge: Wall | null = null;
  private lastVineWall: Wall | null = null;
  private volleys = 0;

  private get rules(): RoseRules {
    return this.config.rules;
  }

  /** Phase slots at this level: volley on even slots, the unlocked off-beat attacks (or 'rest') on odd ones. */
  get order(): readonly RosePhase[] {
    const off = this.rules.offBeat.filter((id) => id in this.resolved.attacks);
    return off.length === 0 ? ['volley', 'rest'] : off.flatMap((id): RosePhase[] => ['volley', id]);
  }

  phaseAt(t: number): RosePhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  protected override nextArrival(id: RoseAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    // A lash stays across the box for `hold`; a bloom's ring keeps crossing for a moment.
    if (p && id === 'vine') tail = this.world.home.width / p.speed! + p.hold!;
    if (p && id === 'bloom') tail = this.world.home.height / p.speed!;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  /** The old Prism wall-phase rate for volleys; vines and blooms run at their band's rate (a lash never overlaps the last). */
  protected override cooldownOf(id: RoseAttack, p: ResolvedAttack): number {
    if (id === 'volley') return p.cooldown! / this.rules.phaseIntensity;
    if (id === 'vine') return Math.max(p.cooldown!, this.vineOccupancy(p));
    return p.cooldown!;
  }

  /**
   * Seconds one lash spends in the box: growing across the widest side, holding, pulling back out
   * (vineRetract x faster), plus vineClear of empty box before the next lash may arrive.
   */
  vineOccupancy(p: ResolvedAttack): number {
    const span = Math.max(this.world.home.width, this.world.home.height);
    const r = this.rules;
    return span / p.speed! + p.hold! + span / (p.speed! * r.vineRetract) + r.vineClear;
  }

  protected override planAhead(id: RoseAttack, p: ResolvedAttack): number {
    if (id === 'bloom') return this.rules.bloomTime + this.bloomTravel() / p.speed!;
    const extent = id === 'volley' ? bulletExtent(this.thornStyle(p)) : this.vineTipExtent();
    return maxOffscreenDistance(this.world.box, extent) / p.speed!;
  }

  protected override update(): void {
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('rosePhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** Thorns, vines and the blooming rose at this level (all prewarmed). */
  override lookSpecs(): LookSpec[] {
    const r = this.rules;
    const out: LookSpec[] = [{ shape: 'composite', form: thornForm(r.volleySize) }];
    if (this.resolved.attacks.vine) out.push({ shape: 'composite', form: this.vine });
    if (this.resolved.attacks.bloom) out.push({ shape: 'composite', form: roseForm(r.roseSize), decor: true });
    return out;
  }

  private get vine() {
    const r = this.rules;
    return vineForm(r.vineLength, r.vineThickness, r.vineThorn, r.vineThornPitch);
  }

  private thornStyle(p: ResolvedAttack): BulletStyle {
    return {
      shape: 'composite', form: thornForm(this.rules.volleySize), a: 0, faceVelocity: true, noPop: true,
      damage: p.damage!, owner: this.id, kind: 'white',
    };
  }

  private pickEdge(): Wall {
    let e: Wall;
    do e = EDGES[Math.floor(this.rng() * 4)]!;
    while (e === this.lastEdge);
    this.lastEdge = e;
    return e;
  }

  // --- Thorn volley (the old Prism edge volley): one edge, constant spacing, one safe gap --
  private planVolley(p: ResolvedAttack): Shot[] {
    // The opening volley is pre-fired (it appears part way in); from a side the row lands beside
    // the box, clear of the HUD bands, where a top/bottom row would appear inside a band.
    const edge = this.volleys++ === 0 ? (this.rng() < 0.5 ? 'left' : 'right') : this.pickEdge();
    this.lastEdge = edge;
    const gapAt = this.rng();
    const style = this.thornStyle(p);
    const lead = lineOffset(this.world.box, { edge, style }) / p.speed!;
    return [{
      lead,
      fire: () => {
        line(this.world.pool, this.world.box, { edge, spacing: this.rules.volleySpacing, speed: p.speed!, gapSize: p.gapSize!, gapAt, style });
      },
    }];
  }

  // --- Vine lash: thorny vines grow in from one wall across the box, with gaps between ---------
  /** How far beyond the tip a vine needs to start off screen (tip only; the stem trails behind, further off). */
  private vineTipExtent(): number {
    return this.rules.vineThickness * 2 + this.rules.vineThorn;
  }

  /**
   * Where the `count` vines of a lash cross a wall of length `len`, as offsets from its middle:
   * every opening (between vines, and between a vine and a corner) is at least `gap` (never below
   * rules.vineMinGap); the rest of the room is shared out at random, so the lanes change every lash.
   * More vines than fit with those openings are dropped (the lash stays dodgeable).
   */
  vineLanes(len: number, count: number, gap: number): number[] {
    const w = vineWidth(this.rules);
    const g = Math.max(gap, this.rules.vineMinGap);
    const n = Math.max(0, Math.min(count, Math.floor((len - g) / (w + g))));
    if (n === 0) return [];
    const slack = len - n * w - (n + 1) * g;
    const weights = Array.from({ length: n + 1 }, () => this.rng() + 0.15);
    const sum = weights.reduce((s, x) => s + x, 0);
    const out: number[] = [];
    let pos = -len / 2;
    for (let i = 0; i < n; i++) {
      pos += g + (slack * weights[i]!) / sum;
      out.push(pos + w / 2);
      pos += w;
    }
    return out;
  }

  private planVine(p: ResolvedAttack): Shot[] {
    const walls = EDGES.filter((e) => e !== this.lastVineWall);
    const wall = walls[Math.floor(this.rng() * walls.length)]!;
    this.lastVineWall = wall;
    const horizontal = wall === 'top' || wall === 'bottom';
    const lanes = this.vineLanes(horizontal ? this.world.box.width : this.world.box.height, p.count!, p.gap!);
    // Lanes are fractions of the wall, so they still span it if the box was resized or shoved since.
    const len0 = horizontal ? this.world.box.width : this.world.box.height;
    const fracs = lanes.map((u) => u / len0);
    const start = (u: number) => {
      const box = this.world.box;
      const [nx, ny] = INWARD[wall];
      const len = horizontal ? box.width : box.height;
      const ex = nx !== 0 ? -nx * box.halfWidth : u * len;
      const ey = ny !== 0 ? -ny * box.halfHeight : u * len;
      return offscreenStart(box, ex, ey, Math.atan2(ny, nx), this.vineTipExtent());
    };
    return [{
      lead: Math.max(0, ...fracs.map((u) => start(u).distance)) / p.speed!,
      fire: () => {
        const box = this.world.box;
        const span = horizontal ? box.height : box.width;
        for (const u of fracs) {
          const s = start(u);
          this.spawnVine(p, s.x, s.y, INWARD[wall], s.distance + span);
        }
      },
    }];
  }

  /**
   * One vine: its tip grows (moves) in from off screen along `dir` at `speed` until it reaches
   * `reach` (the far wall), holds for `hold`, then pulls back out the way it came (vineRetract x faster). Its stem trails
   * off screen behind the tip the whole time, so it reads as a vine growing in from the edge.
   * The vine stops early if its stem's end would come on screen (a very displaced box).
   */
  private spawnVine(p: ResolvedAttack, x: number, y: number, dir: [number, number], reach: number): void {
    const r = this.rules;
    const stop = Math.min(reach, r.vineLength - r.vineThickness * 3);
    const tGrow = stop / p.speed!;
    const back = p.speed! * r.vineRetract;
    const vx = dir[0] * p.speed!;
    const vy = dir[1] * p.speed!;
    this.world.pool.spawn({
      shape: 'composite', form: this.vine, a: 0, x, y, vx, vy, rotation: Math.atan2(dir[1], dir[0]),
      damage: p.damage!, owner: this.id, kind: 'white', noPop: true,
      lifetime: tGrow + p.hold! + stop / back,
      onStep: (b: Bullet) => {
        // Grow, hold, then retract along its own (world-fixed) heading: rotation never changes.
        if (b.age < tGrow) return;
        const k = b.age < tGrow + p.hold! ? 0 : -back;
        b.vx = Math.cos(b.rotation) * k;
        b.vy = Math.sin(b.rotation) * k;
      },
    });
  }

  // --- Bloom: roses bloom (gold, harmless) just outside the box, then burst into rings of thorns ---
  /** How far a thorn travels to the wall: the ring starts on the rose's rim (roseSize out), bloomGap from the wall. */
  private bloomTravel(): number {
    return this.rules.bloomGap;
  }

  private planBloom(p: ResolvedAttack): Shot[] {
    const walls = [...EDGES];
    for (let i = walls.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [walls[i], walls[j]] = [walls[j]!, walls[i]!];
    }
    const lead = this.rules.bloomTime + this.bloomTravel() / p.speed!;
    return walls.slice(0, Math.min(4, p.count!)).map((wall) => {
      const u = this.rng() - 0.5; // along the wall, -0.5..0.5 of its half length
      const spin = this.rng() * Math.PI * 2;
      return { lead, fire: () => void this.bloom(p, wall, u, spin) };
    });
  }

  /**
   * A rose (decor: gold like a forming projectile, never collides) blooms `bloomTime` s just outside
   * `wall` of the soul's box (as it is now), then bursts into a ring of `ring` white thorns flying
   * out from its center; the inward half crosses the box. Skipped if the rose and its ring's start
   * would sit in a HUD band or off screen.
   */
  bloom(p: ResolvedAttack, wall: Wall, u = 0, spin = 0): Bullet | null {
    const r = this.rules;
    const box = this.world.box;
    const [nx, ny] = INWARD[wall];
    const out = r.bloomGap + r.roseSize;
    const cx = nx !== 0 ? -nx * (box.halfWidth + out) : u * box.halfWidth;
    const cy = ny !== 0 ? -ny * (box.halfHeight + out) : u * box.halfHeight;
    let burst = false;
    const rose = this.world.pool.spawn({
      shape: 'composite', form: roseForm(r.roseSize), a: 0, x: cx, y: cy, rotation: spin, damage: 0, owner: this.id,
      decor: true, tint: theme.preActive, edgeTint: theme.bullet.white, lifetime: r.bloomTime + 0.05,
      onStep: (b: Bullet) => {
        if (burst || b.age < r.bloomTime - 1e-9) return;
        burst = true;
        ring(this.world.pool, {
          x: b.x, y: b.y, count: p.ring!, speed: p.speed!, radius: r.roseSize, angleOffset: spin,
          style: { ...this.thornStyle(p), flags: 1 },
        });
      },
    });
    if (!rose) return null;
    // The ring starts at roseSize from the center, thorns reaching a volleySize further.
    const a = bulletWorldAabb(box, rose);
    const pad = r.volleySize;
    if (aabbInBand({ x0: a.x0 - pad, y0: a.y0 - pad, x1: a.x1 + pad, y1: a.y1 + pad }) || a.x0 - pad < 0 || a.x1 + pad > SCREEN_WIDTH || a.y0 - pad < 0 || a.y1 + pad > SCREEN_HEIGHT) {
      this.world.pool.release(rose, 'cancel');
      return null;
    }
    return rose;
  }
}
