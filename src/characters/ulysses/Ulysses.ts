import { Character, type Shot } from '../Character';
import type { ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { ArmHook, Bullet, StepHook, Wall } from '../../combat/Bullet';
import { line, lineSlots, type BulletStyle } from '../../combat/patterns';
import { theme } from '../../render/theme';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import type { LookSpec } from '../Character';
import { SWORD_FLAGS, SWORD_FORM, axeForm, ulyssesConfig, type UlyssesAttack, type UlyssesRules } from './ulysses.config';

export type UlyssesPhaseState = PhaseState<UlyssesAttack>;

const EDGES: Wall[] = ['left', 'right', 'top', 'bottom'];
/** Inward unit normal for each edge. */
const INWARD: Record<Wall, [number, number]> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };

/**
 * Prince Ulysses: swords form gold (pre-active, harmless) just outside the box, shine white and
 * only then hurt (Bullet.armDelay). An attack's beat is its shine: each Shot's lead is its gold time.
 * Swords form on screen on purpose (the gold stage is the warning), so there is no opening pre-fire.
 */
export class Ulysses extends Character<UlyssesAttack, UlyssesRules> {
  readonly id = 'ulysses';
  readonly color = theme.ulysses;
  readonly config = ulyssesConfig;
  protected readonly attacks = {
    summon: (p: ResolvedAttack) => this.planSummon(p),
    axe: (p: ResolvedAttack) => this.planAxe(p),
    rain: (p: ResolvedAttack) => this.planRain(p),
  };
  protected override readonly preFireOpening = false;
  /** Phase as of the last step ('' until the first tick). */
  phase: UlyssesAttack | 'breather' | '' = '';
  private lastEdge: Wall | null = null;
  private lastCorner = -1;

  private get rules(): UlyssesRules {
    return this.config.rules;
  }

  /** Unlocked attacks in phase order (one phase each). */
  get order(): readonly UlyssesAttack[] {
    return this.rules.phaseOrder.filter((id) => id in this.resolved.attacks);
  }

  phaseAt(t: number): UlyssesPhaseState {
    return phaseAt(this.rules, this.order, t);
  }

  /** Shines only inside the attack's phase; multi-shine attacks must finish inside it too. */
  protected override nextArrival(id: UlyssesAttack, at: number): number {
    const p = this.resolved.attacks[id];
    let tail = 0;
    if (p && id === 'axe' && p.double! > 0) tail = this.rules.axeGap;
    if (p && id === 'rain') tail = p.jitter!;
    return nextPhaseArrival(this.rules, this.order, id, at, tail);
  }

  protected override planAhead(id: UlyssesAttack, p: ResolvedAttack): number {
    return id === 'summon' ? p.grow! : p.windup!;
  }

  protected override update(): void {
    if (this.order.length === 0) return;
    const st = this.phaseAt(this.clock);
    if (st.phase !== this.phase) {
      this.phase = st.phase;
      this.world.bus.emit('ulyssesPhaseChanged', { owner: this.id, phase: st.phase, next: st.next });
    }
  }

  /** Swords (gold then white, with a shine) and both axe sides at this level's reach. */
  override lookSpecs(): LookSpec[] {
    const out: LookSpec[] = [{ shape: 'composite', form: SWORD_FORM, shine: true }];
    const axe = this.resolved.attacks.axe;
    if (axe) for (const side of [1, -1] as const) out.push({ shape: 'composite', form: axeForm(axe.reach!, side), shine: true });
    return out;
  }

  private pickEdge(): Wall {
    let e: Wall;
    do e = EDGES[Math.floor(this.rng() * 4)]!;
    while (e === this.lastEdge);
    this.lastEdge = e;
    return e;
  }

  /** A thrown sword (composite: blade, crossguard, grip, pommel): white once active, gold (growing) for `gold` s before. */
  private swordStyle(p: ResolvedAttack, gold: number, rotation: number, extra: Partial<BulletStyle> = {}): BulletStyle {
    return {
      shape: 'composite', form: SWORD_FORM, a: 0, rotation, damage: p.damage!, owner: this.id, kind: 'white',
      noPop: true, armDelay: gold, growIn: true, flags: SWORD_FLAGS.sword, ...extra,
    };
  }

  /** Offset from a wall to a forming sword's center, so the whole sword is just outside the box. */
  private formOffset(halfDepth: number): number {
    return this.rules.formGap + halfDepth;
  }

  // --- Summoned swords: grow outside the box, shine, lock onto the soul, fly through ---
  private planSummon(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const first = this.pickEdge();
    const rowFor = (edge: Wall) => {
      const [nx, ny] = INWARD[edge];
      const style = this.swordStyle(p, p.grow!, Math.atan2(ny, nx), { onArm: this.lockOn(p.speed!) });
      return { edge, count: this.rules.summonSlots, speed: 0, offset: this.formOffset(this.rules.swordLength / 2), style };
    };
    const gaps = this.gapsFor(lineSlots(box, rowFor(first)), p.count!);
    // Formed against the box as it is at the spawn moment (it may have been shoved or turned). If
    // the row would form in a HUD band, the next edge that fits is used instead.
    const others = EDGES.filter((e) => e !== first);
    return [{ lead: p.grow!, fire: () => void this.spawnClear([first, ...others].map((e) => () => line(pool, this.world.box, { ...rowFor(e), gaps }))) }];
  }

  /**
   * Run the first spawner whose new bullets all form clear of the HUD bands; a row that would not
   * is removed unseen ('cancel') and the next is tried. Returns whether one fitted.
   */
  private spawnClear(spawners: (() => unknown)[]): boolean {
    const pool = this.world.pool;
    for (const spawn of spawners) {
      const before = new Set(pool.all.filter((b) => b.active));
      spawn();
      const fresh = pool.all.filter((b) => b.active && !before.has(b));
      if (!fresh.some((b) => this.inBand(b))) return true;
      for (const b of fresh) pool.release(b, 'cancel');
    }
    return false;
  }

  private inBand(b: Bullet): boolean {
    return aabbInBand(bulletWorldAabb(this.world.box, b));
  }

  /** At the shine: aim at where the soul is right now, and fly there and beyond. */
  private lockOn(speed: number): ArmHook {
    return (b: Bullet) => {
      const s = this.world.soul.pos;
      const a = Math.atan2(s.y - b.y, s.x - b.x);
      b.vx = Math.cos(a) * speed;
      b.vy = Math.sin(a) * speed;
      b.rotation = a;
      b.faceVelocity = true;
    };
  }

  // --- Axe swing: forms at a box corner, shines, swings in an arc around that corner -----
  private planAxe(p: ResolvedAttack): Shot[] {
    const fire = () => {
      const first = this.pickCorner();
      // A corner whose resting axe would form in a HUD band (box shoved toward one) is skipped.
      void this.spawnClear([0, 1, 2, 3].map((k) => () => this.spawnAxe(p, (first + k) % 4)));
    };
    const shots: Shot[] = [{ lead: p.windup!, fire }];
    // Sometimes a second corner, axeGap after the first shine.
    if (this.rng() < p.double!) shots.push({ lead: p.windup! - this.rules.axeGap, fire });
    return shots;
  }

  /** Corner index 0..3 = (-,-), (+,-), (+,+), (-,+) in box-local signs; never the same twice in a row. */
  private pickCorner(): number {
    let c: number;
    do c = Math.floor(this.rng() * 4);
    while (c === this.lastCorner);
    this.lastCorner = c;
    return c;
  }

  /**
   * One axe pivoting on box corner `corner`. It rests just outside the box (axeRest past one wall
   * line, gold), shines, then rotates toward the other wall at `speed` rad/s through `arc`, sweeping
   * the area near the corner. The bullet's position IS the pivot and is kept on the current corner
   * every step, and its parts rotate with it, so the drawn axe is the hitbox through the whole arc,
   * in a moved, rotated or resized box.
   */
  private spawnAxe(p: ResolvedAttack, corner: number): void {
    const { box, pool } = this.world;
    const cx = corner === 1 || corner === 2 ? 1 : -1;
    const cy = corner >= 2 ? 1 : -1;
    // Directions from the corner along its two walls, into the box.
    const alongX = Math.atan2(0, -cx);
    const alongY = Math.atan2(-cy, 0);
    const [from, to] = this.rng() < 0.5 ? [alongX, alongY] : [alongY, alongX];
    const sign: 1 | -1 = Math.sin(to - from) > 0 ? 1 : -1;
    const start = from - sign * this.rules.axeRest;
    const end = start + sign * p.arc!;
    const speed = p.speed!;
    pool.spawn({
      shape: 'composite', form: axeForm(p.reach!, sign), a: 0, rotation: start,
      x: cx * box.halfWidth, y: cy * box.halfHeight,
      damage: p.damage!, owner: this.id, kind: 'white', noPop: true, armDelay: p.windup!, growIn: true,
      onStep: (b: Bullet, dt: number) => {
        b.x = cx * this.world.box.halfWidth;
        b.y = cy * this.world.box.halfHeight;
        // Still forming and the box was pushed so the gold axe would sit in a HUD band: it fades away.
        if (!b.armed && this.inBand(b)) {
          this.world.pool.release(b, 'cleared');
          return;
        }
        if (!b.armed || b.lifetime !== Infinity) return;
        const left = (end - b.rotation) * sign;
        b.rotation += sign * Math.min(left, speed * dt);
        if (left <= speed * dt) b.lifetime = b.age + 0.05; // swing done: gone next step or so
      },
    });
  }

  // --- Sword rain: a dense row forms above the box, shines almost at once, drops -------
  /**
   * `count` slots across the top edge with ONE contiguous opening at least rainGap wide between
   * the nearest crossguards (wider than the soul), at a random place, so every row is dodgeable
   * without a dash.
   */
  private planRain(p: ResolvedAttack): Shot[] {
    const { pool } = this.world;
    const count = p.count!;
    const style = this.swordStyle(p, p.windup!, Math.PI / 2, { onStep: this.rainHook(p) });
    const opts = { edge: 'top' as const, count, speed: 0, offset: this.formOffset(this.rules.swordLength / 2), style };
    const gapAt = this.rng();
    // A row that would form in the top HUD band (box shoved up) is skipped.
    return [{ lead: p.windup!, fire: () => {
      // Against the soul's box as it is now (half width while The Warden has the box split).
      const b = this.world.box;
      const gapSize = rainGapSlots(b.width, count, this.rules.swordWidth, this.rules.rainGap);
      void this.spawnClear([() => line(pool, b, { ...opts, gapSize, gapAt })]);
    } }];
  }

  /** Each sword shines up to `jitter` s after the row's beat (nearly together), then drops fallGap later. */
  private rainHook(p: ResolvedAttack): StepHook {
    return (b: Bullet) => {
      if (!(b.flags & SWORD_FLAGS.ordered)) {
        b.flags |= SWORD_FLAGS.ordered;
        b.armAt += this.rng() * p.jitter!;
      }
      if (b.armed && b.vy === 0 && b.age >= b.armAt + p.fallGap!) {
        b.vy = p.speed!;
        b.faceVelocity = true;
      }
    };
  }

  private shuffled(n: number): number[] {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    return idx;
  }

  /** `count` filled slots out of `slots`, at random; the rest are gaps. */
  private gapsFor(slots: number, count: number): number[] {
    return this.shuffled(slots).slice(Math.min(count, slots));
  }
}

/**
 * Empty slots needed so the opening between the crossguards beside the gap is at least `gap` px:
 * with slot spacing s, k empty slots leave (k + 1) * s - 2 * halfWidth.
 */
export function rainGapSlots(span: number, count: number, halfWidth: number, gap: number): number {
  const s = span / count;
  return Math.max(1, Math.ceil((gap + 2 * halfWidth) / s - 1 - 1e-9));
}
