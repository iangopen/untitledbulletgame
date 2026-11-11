import { Character } from '../Character';
import type { ResolvedAttack } from '../config';
import type { Bullet, BulletContext, Wall, WallResponse } from '../../combat/Bullet';
import { pointInTriangle, type Triangle } from '../../combat/Collision';
import { line } from '../../combat/patterns';
import type { Prop } from '../../core/World';
import { theme } from '../../render/theme';
import { px } from '../../tuning';
import { prismConfig, type PrismAttack, type PrismRules } from './prism.config';

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
    volley: (p: ResolvedAttack) => this.fireVolley(p),
    beam: (p: ResolvedAttack) => this.fireBeams(p),
    prism: (p: ResolvedAttack) => this.placePrism(p),
  };

  /** The refraction prism while level >= 15, else null. */
  prop: Prop | null = null;
  private lastEdge: Wall | null = null;
  private readonly tri: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };
  private readonly onBeamWall = (b: Bullet, wall: Wall, ctx: BulletContext): WallResponse => this.beamHitWall(b, wall, ctx);

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

  // --- Levels 1+: triangle volleys from one edge, with a clear gap ---------
  private fireVolley(p: ResolvedAttack): void {
    const count = p.count!;
    const gap = p.gapSize!;
    const start = Math.floor(this.rng() * (count - gap + 1));
    const gaps = Array.from({ length: gap }, (_, i) => start + i);
    line(this.world.pool, this.world.box, {
      edge: this.pickEdge(),
      count,
      speed: p.speed!,
      gaps,
      style: {
        shape: 'triangle', a: this.rules.volleySize, faceVelocity: true,
        damage: p.damage!, owner: this.id, kind: 'white',
      },
    });
  }

  // --- Levels 6+: beams that split in two at a wall --------------------------
  private fireBeams(p: ResolvedAttack): void {
    const { box } = this.world;
    const prismP = this.resolved.attacks.prism;
    for (let i = 0; i < p.count!; i++) {
      const edge = EDGES[Math.floor(this.rng() * 4)]!;
      const [nx, ny] = INWARD[edge];
      const u = this.rng() * 1.6 - 0.8; // position along the edge, -0.8..0.8 of half length
      const x = nx !== 0 ? -nx * (box.halfWidth + px(10)) : u * box.halfWidth;
      const y = ny !== 0 ? -ny * (box.halfHeight + px(10)) : u * box.halfHeight;
      let angle = Math.atan2(ny, nx) + (this.rng() - 0.5) * 0.7;
      if (this.prop && prismP && this.rng() < prismP.aimChance!) angle = Math.atan2(this.prop.y - y, this.prop.x - x);
      this.spawnBeam(x, y, angle, p.speed!, p, 0, 0, false);
    }
  }

  private spawnBeam(x: number, y: number, angle: number, speed: number, p: ResolvedAttack, gen: number, flags: number, child: boolean): void {
    const b = this.world.pool.spawn({
      shape: 'beam', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, faceVelocity: true,
      a: p.length!, b: this.rules.beamThickness, damage: p.damage!, owner: this.id, kind: 'white',
      gen, flags, noPop: child, onWall: this.onBeamWall,
    });
    if (b) this.world.bus.emit('beamFired', { owner: this.id, x, y, angle, gen });
  }

  private canSplit(b: Bullet): boolean {
    if (b.gen >= this.rules.splitMaxGeneration) return false;
    if (b.flags & REFRACTED && !this.rules.refractedCanSplit) return false;
    return true;
  }

  private beamHitWall(b: Bullet, wall: Wall, _ctx: BulletContext): WallResponse {
    const p = this.resolved.attacks.beam;
    const split = !!p && this.canSplit(b);
    this.world.bus.emit('beamHitWall', { owner: this.id, wall, x: b.x, y: b.y, gen: b.gen, split });
    if (!split) return 'pass';
    const { box } = this.world;
    // Reflect off the wall, then split into two halves either side of the reflection.
    const vertical = wall === 'left' || wall === 'right';
    const rvx = vertical ? -b.vx : b.vx;
    const rvy = vertical ? b.vy : -b.vy;
    const base = Math.atan2(rvy, rvx);
    const speed = Math.hypot(b.vx, b.vy);
    const x = Math.max(-box.halfWidth, Math.min(box.halfWidth, b.x));
    const y = Math.max(-box.halfHeight, Math.min(box.halfHeight, b.y));
    for (const s of [-0.5, 0.5]) this.spawnBeam(x, y, base + s * p.splitSpread!, speed, p, b.gen + 1, b.flags, true);
    return 'die';
  }

  // --- Levels 15+: refraction prism -----------------------------------------
  private placePrism(_p: ResolvedAttack): void {
    const { box } = this.world;
    const r = this.rules.prismRadius;
    if (!this.prop) {
      this.prop = { shape: 'triangle', x: 0, y: 0, r, rotation: 0, color: this.color };
      this.world.props.push(this.prop);
    }
    this.prop.x = (this.rng() * 2 - 1) * (box.halfWidth - r - px(20));
    this.prop.y = (this.rng() * 2 - 1) * (box.halfHeight - r - px(20));
    this.prop.rotation = this.rng() * Math.PI * 2;
  }

  private prismTriangle(prop: Prop): Triangle {
    const t = this.tri;
    const k = (2 * Math.PI) / 3;
    t.ax = prop.x + Math.cos(prop.rotation) * prop.r;
    t.ay = prop.y + Math.sin(prop.rotation) * prop.r;
    t.bx = prop.x + Math.cos(prop.rotation + k) * prop.r;
    t.by = prop.y + Math.sin(prop.rotation + k) * prop.r;
    t.cx = prop.x + Math.cos(prop.rotation + 2 * k) * prop.r;
    t.cy = prop.y + Math.sin(prop.rotation + 2 * k) * prop.r;
    return t;
  }

  /** Any of our beams whose center enters the prism fans into refractCount beams that ignore prisms. */
  protected override update(): void {
    const prop = this.prop;
    const pp = this.resolved.attacks.prism;
    const bp = this.resolved.attacks.beam;
    if (!prop || !pp || !bp) return;
    const tri = this.prismTriangle(prop);
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
        this.spawnBeam(x, y, angle + t * pp.refractSpread!, speed, bp, gen, flags, true);
      }
      this.world.bus.emit('beamRefracted', { owner: this.id, x, y, count: n });
    }
  }

  protected override onLevelChanged(): void {
    const pp = this.resolved.attacks.prism;
    if (!pp) this.removePrism();
    else if (!this.prop) this.placePrism(pp);
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
