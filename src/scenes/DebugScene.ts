import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { theme, toCss } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { aimed, fan, line, ring } from '../combat/patterns';
import type { Wall } from '../combat/Bullet';
import { STEP } from '../core/Clock';

/**
 * DEV ONLY. Fire each pattern on demand and watch counts and step time.
 * 1 line · 2 fan · 3 ring · 4 aimed · 5 spinning rects · 6 splitting beams (wall hook)
 * 7 KR ring · 8 bouncing triangles · 0 stress (+300) · C clear · I invincible · H hitboxes · ` back
 */
export class DebugScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private readout!: Phaser.GameObjects.Text;
  private invincible = false;
  private edgeIdx = 0;
  private stepSamples: number[] = [];

  constructor() {
    super('Debug');
  }

  create(): void {
    const { width, height } = this.scale;
    this.world = new World(width / 2, height / 2 - 20);
    this.view = new BattleView(this, this.world);
    this.view.showHitboxes = true;
    this.loop = new FixedLoop(this);
    this.stepSamples = [];
    const mono = { fontFamily: 'monospace', fontSize: '12px', color: toCss(theme.textDim) };
    this.readout = this.add.text(8, 6, '', { ...mono, color: toCss(theme.text) });
    this.add
      .text(width / 2, height - 26, '1 line 2 fan 3 ring 4 aimed 5 rects 6 split-beams 7 KR 8 bounce 0 stress\nC clear  I invincible  H hitboxes  ` back', { ...mono, align: 'center' })
      .setOrigin(0.5);

    const kb = this.input.keyboard!;
    const fire: Record<string, () => void> = {
      ONE: () => this.fireLine(),
      TWO: () => fan(this.world.pool, { x: 0, y: -this.world.box.halfHeight, angle: Math.PI / 2, count: 9, spread: 1.6, speed: 120 }),
      THREE: () => ring(this.world.pool, { x: 0, y: 0, count: 24, speed: 90, radius: 30, style: { a: 5 } }),
      FOUR: () => aimed(this.world.pool, { x: this.world.box.halfWidth, y: -this.world.box.halfHeight, target: this.world.soul.pos, speed: 180, count: 3, spread: 0.3 }),
      FIVE: () => ring(this.world.pool, { x: 0, y: 0, count: 10, speed: 60, radius: 20, style: { shape: 'rect', a: 10, b: 4, spin: 3 } }),
      SIX: () => this.fireSplitBeams(),
      SEVEN: () => ring(this.world.pool, { x: 0, y: 0, count: 12, speed: 70, radius: 25, style: { a: 6, type: 'kr', damage: 15 } }),
      EIGHT: () => ring(this.world.pool, { x: 0, y: 0, count: 8, speed: 110, radius: 20, style: { shape: 'triangle', a: 8, spin: 2, lifetime: 6, onWall: () => 'bounce' } }),
      ZERO: () => this.stress(),
    };
    for (const [key, fn] of Object.entries(fire)) kb.on(`keydown-${key}`, fn);
    kb.on('keydown-C', () => this.world.pool.clear());
    kb.on('keydown-I', () => (this.invincible = !this.invincible));
    kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
    kb.on('keydown-BACKTICK', () => this.scene.start('Battle'));

    (window as unknown as Record<string, unknown>).__debug = {
      world: this.world, view: this.view, loop: this.loop, game: this.game, fire,
      setInvincible: (v: boolean) => (this.invincible = v),
    };
  }

  private fireLine(): void {
    const edges: Wall[] = ['left', 'top', 'right', 'bottom'];
    const edge = edges[this.edgeIdx++ % 4]!;
    line(this.world.pool, this.world.box, { edge, count: 10, speed: 110, gaps: [4, 5] });
  }

  /** Demonstrates the wall hook: beams split into two at the wall they hit (Prism-style). */
  private fireSplitBeams(): void {
    const w = this.world;
    for (const angle of [-0.6, 0, 0.6]) {
      w.pool.spawn({
        shape: 'beam', x: 0, y: 0, vx: Math.cos(angle) * 160, vy: Math.sin(angle) * 160,
        faceVelocity: true, a: 26, b: 4, damage: 6,
        onWall: (b, wall, ctx) => {
          if (b.owner === 'child') return 'die';
          const vertical = wall === 'left' || wall === 'right';
          for (const s of [-1, 1]) {
            const vx = vertical ? -b.vx * 0.8 : b.vx * 0.8 + s * 60;
            const vy = vertical ? b.vy * 0.8 + s * 60 : -b.vy * 0.8;
            ctx.spawn({
              shape: 'beam', x: b.x, y: b.y, vx, vy, faceVelocity: true,
              a: 18, b: 3, damage: 5, owner: 'child', noPop: true,
              onWall: () => 'die',
            });
          }
          return 'die';
        },
      });
    }
  }

  private stress(): void {
    const w = this.world;
    for (let i = 0; i < 300; i++) {
      const a = (i / 300) * Math.PI * 2 * 7;
      const shape = (['circle', 'rect', 'triangle', 'beam'] as const)[i % 4]!;
      w.pool.spawn({
        shape, x: Math.cos(a) * 20, y: Math.sin(a) * 20,
        vx: Math.cos(a) * (20 + (i % 13) * 4), vy: Math.sin(a) * (20 + (i % 13) * 4),
        a: shape === 'beam' ? 16 : 4, b: 2, spin: 1.5, damage: 1,
      });
    }
  }

  update(): void {
    const w = this.world;
    this.loop.frame((input, dt) => {
      if (this.invincible) w.soul.iframes = Math.max(w.soul.iframes, 2 * STEP);
      w.step(input, dt);
    });
    if (this.loop.lastStepMs > 0) {
      this.stepSamples.push(this.loop.lastStepMs);
      if (this.stepSamples.length > 120) this.stepSamples.shift();
    }
    this.view.draw(this.loop.realDt);
    const avg = this.stepSamples.reduce((s, x) => s + x, 0) / Math.max(1, this.stepSamples.length);
    this.readout.setText(
      `DEBUG  bullets ${w.pool.activeCount}/${w.pool.capacity}  dropped ${w.pool.dropped}\n` +
        `step avg ${avg.toFixed(3)} ms  max ${this.loop.maxStepMs.toFixed(3)} ms  (budget ${(STEP * 1000).toFixed(1)} ms)\n` +
        `hp ${Math.ceil(w.soul.hp)}  kr ${w.soul.kr.toFixed(1)}  ${this.invincible ? 'INVINCIBLE' : ''}`,
    );
  }
}
