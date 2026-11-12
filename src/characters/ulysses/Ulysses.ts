import { Character, type Shot } from '../Character';
import type { ResolvedAttack } from '../config';
import { nextPhaseArrival, phaseAt, type PhaseState } from '../phases';
import type { ArmHook, Bullet, StepHook, Wall } from '../../combat/Bullet';
import { line, lineSlots, type BulletStyle } from '../../combat/patterns';
import { theme } from '../../render/theme';
import { SWORD_FLAGS, ulyssesConfig, type UlyssesAttack, type UlyssesRules } from './ulysses.config';

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
    swipe: (p: ResolvedAttack) => this.planSwipe(p),
    rain: (p: ResolvedAttack) => this.planRain(p),
  };
  protected override readonly preFireOpening = false;
  /** Phase as of the last step ('' until the first tick). */
  phase: UlyssesAttack | 'breather' | '' = '';
  private lastEdge: Wall | null = null;

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
    if (p && id === 'swipe' && p.double! > 0) tail = this.rules.swipeGap;
    if (p && id === 'rain') tail = (p.count! - 1) * p.stagger!;
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

  private pickEdge(): Wall {
    let e: Wall;
    do e = EDGES[Math.floor(this.rng() * 4)]!;
    while (e === this.lastEdge);
    this.lastEdge = e;
    return e;
  }

  /** A thrown sword: white once active, gold (growing) for `gold` seconds before. */
  private swordStyle(p: ResolvedAttack, gold: number, rotation: number, extra: Partial<BulletStyle> = {}): BulletStyle {
    const r = this.rules;
    return {
      shape: 'beam', a: r.swordLength, b: r.swordWidth, rotation, damage: p.damage!, owner: this.id, kind: 'white',
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
    const edge = this.pickEdge();
    const [nx, ny] = INWARD[edge];
    const style = this.swordStyle(p, p.grow!, Math.atan2(ny, nx), { onArm: this.lockOn(p.speed!) });
    const opts = { edge, count: this.rules.summonSlots, speed: 0, offset: this.formOffset(this.rules.swordLength / 2), style };
    const gaps = this.gapsFor(lineSlots(box, opts), p.count!);
    return [{ lead: p.grow!, fire: () => void line(pool, box, { ...opts, gaps }) }];
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

  // --- Side swipe: a long blade forms along one side, shines, sweeps across ---------
  private planSwipe(p: ResolvedAttack): Shot[] {
    const shots: Shot[] = [{ lead: p.windup!, fire: () => this.spawnBlade(p, this.pickEdge()) }];
    // Sometimes a second swipe from another side, swipeGap after the first shine.
    if (this.rng() < p.double!) shots.push({ lead: p.windup! - this.rules.swipeGap, fire: () => this.spawnBlade(p, this.pickEdge()) });
    return shots;
  }

  /**
   * One blade: a beam lying along `edge`, `coverage` of its length, at a random place along it,
   * just outside the wall. Box-local like every bullet, so it follows a rotated box exactly; its
   * drawn rect is its hitbox through the whole sweep (it translates, never deforms).
   */
  private spawnBlade(p: ResolvedAttack, edge: Wall): void {
    const { box, pool } = this.world;
    const [nx, ny] = INWARD[edge];
    const alongX = ny !== 0; // top/bottom: the blade lies along x
    const side = alongX ? box.width : box.height;
    const len = p.coverage! * side;
    const along = (this.rng() - 0.5) * (side - len);
    const off = (alongX ? box.halfHeight : box.halfWidth) + this.formOffset(this.rules.swipeThickness / 2);
    const speed = p.speed!;
    pool.spawn({
      shape: 'beam', a: len, b: this.rules.swipeThickness, rotation: alongX ? 0 : Math.PI / 2,
      x: alongX ? along : -nx * off, y: alongX ? -ny * off : along,
      damage: p.damage!, owner: this.id, kind: 'white', noPop: true, armDelay: p.windup!, growIn: true,
      onArm: (b) => {
        b.vx = nx * speed;
        b.vy = ny * speed;
      },
    });
  }

  // --- Sword rain: a row forms above the box, shines in random order, drops -----------
  private planRain(p: ResolvedAttack): Shot[] {
    const { box, pool } = this.world;
    const count = p.count!;
    const style = this.swordStyle(p, p.windup!, Math.PI / 2, { onStep: this.rainHook(p, count) });
    const opts = { edge: 'top' as const, count, speed: 0, offset: this.formOffset(this.rules.swordLength / 2), style };
    return [{ lead: p.windup!, fire: () => void line(pool, box, opts) }];
  }

  /**
   * Each sword of a row takes the next place in a shuffled shine order on its first step (shines
   * stagger s apart), then drops fallGap after its shine.
   */
  private rainHook(p: ResolvedAttack, count: number): StepHook {
    const order = this.shuffled(count);
    let next = 0;
    return (b: Bullet) => {
      if (!(b.flags & SWORD_FLAGS.ordered)) {
        b.flags |= SWORD_FLAGS.ordered;
        b.armAt += (order[next++ % count] ?? 0) * p.stagger!;
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
