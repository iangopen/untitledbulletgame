import { Ulysses } from '../characters/ulysses/Ulysses';
import { SWORD_FLAGS, SWORD_FORM } from '../characters/ulysses/ulysses.config';
import { installInteractions } from '../director/interactions';
import { Mortimer } from '../characters/mortimer/Mortimer';
import { Warden } from '../characters/warden/Warden';
import { wardenConfig } from '../characters/warden/warden.config';
import { resolveLevel } from '../characters/config';
import Phaser from 'phaser';
import { PROJECTILE_TYPES } from '../combat/projectile';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { VIEW, fonts, theme, toCss, type } from '../render/theme';
import { applyView, renderScale } from '../render/display';
import { ui } from '../ui/UiLayer';
import { px } from '../tuning';
import { FixedLoop } from './FixedLoop';
import { aimed, fan, line, ring } from '../combat/patterns';
import type { Wall } from '../combat/Bullet';
import { STEP } from '../core/Clock';
import { WALLS } from '../core/Box';
import { WALL_DAMAGE } from '../tuning';
import { characterById, registry } from '../characters/registry';
import type { CharacterHandle } from '../characters/Character';

/**
 * DEV ONLY. Fire each pattern on demand and watch counts and step time.
 * 1 line · 2 fan · 3 ring · 4 aimed · 5 spinning rects · 6 splitting beams (wall hook) · 9 one bullet of each projectile type
 * 7 KR ring · 8 bouncing triangles · 0 stress (+300) · C clear · I invincible · H hitboxes · ` back
 * Box: Q/E rotate -/+30 deg · R +90 · T +180 · F resize small/default · G move · V fast squeeze left
 *      B slow squeeze right · N cycle damaging walls · M continuous motion · P prism 0/20 · Z reset box
 * Mortimer (level 20 params, fired now from off screen): J snowfall · K snowball roll · L blizzard
 * Ulysses (level 20 params): U summon · Y axe swing · O sword rain
 * The Warden (level 20 params): , punch (and the return) · / spin · [ rip apart · ] merge punch · \ re-center
 * Combos: X sword through a refraction prism (Prism + Ulysses) · . toggle Mortimer's blizzard phase (swords sync)
 */
export class DebugScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private readout!: Phaser.GameObjects.Text;
  private invincible = false;
  private edgeIdx = 0;
  private stepSamples: number[] = [];
  private small = false;
  private moveIdx = 0;
  private wallMode = 0;
  private chaos = false;
  private chaosT = 0;
  private boxText!: Phaser.GameObjects.Text;
  private prism!: CharacterHandle;
  private mortimer!: Mortimer;
  private ulysses!: Ulysses;
  private warden!: Warden;
  private blizzard = false;

  constructor() {
    super('Debug');
  }

  create(): void {
    applyView(this);
    ui.clear(); // dev scene uses Phaser text; no HTML screen
    const { width, height } = VIEW;
    this.world = new World(VIEW.cx, VIEW.cy + px(6));
    this.view = new BattleView(this, this.world);
    this.view.showHitboxes = true;
    this.prism = characterById('prism')!.create(this.world);
    this.mortimer = new Mortimer(this.world, 2);
    this.ulysses = new Ulysses(this.world, 3);
    this.warden = new Warden(this.world, 4);
    // Every combo rule, as if all characters were active, so X and . can show them.
    const offCombos = installInteractions(this.world, new Set(registry.map((e) => e.id)));
    this.blizzard = false;
    this.events.once('shutdown', () => {
      this.prism.dispose();
      this.mortimer.dispose();
      this.ulysses.dispose();
      this.warden.dispose();
      offCombos();
    });
    this.loop = new FixedLoop(this);
    this.stepSamples = [];
    const mono = { fontFamily: fonts.mono, fontSize: `${type.hint}px`, color: toCss(theme.textDim) };
    this.readout = this.add.text(16, 12, '', { ...mono, color: toCss(theme.text) }).setResolution(renderScale());
    this.boxText = this.add.text(16, 80, '', { ...mono, color: toCss(theme.textDim) }).setResolution(renderScale());
    this.add
      .text(width / 2, height - 50, '1 line 2 fan 3 ring 4 aimed 5 rects 6 split 7 KR 8 bounce 9 types 0 stress\nC clear  I invincible  H hitboxes  P prism 0/20  J/K/L mortimer  U/Y/O ulysses  , / [ ] \ warden  X . combos  ` back\nbox: Q/E rot30  R 90  T 180  F size  G move  V/B squeeze  N walls  M motion  Z reset', { ...mono, align: 'center' })
      .setOrigin(0.5)
      .setResolution(renderScale());

    const kb = this.input.keyboard!;
    const fire: Record<string, () => void> = {
      ONE: () => this.fireLine(),
      TWO: () => fan(this.world.pool, { x: 0, y: -this.world.box.halfHeight, angle: Math.PI / 2, count: 9, spread: 1.6, speed: px(120) }),
      THREE: () => ring(this.world.pool, { x: 0, y: 0, count: 24, speed: px(90), radius: px(30), style: { a: px(5) } }),
      FOUR: () => aimed(this.world.pool, { x: this.world.box.halfWidth, y: -this.world.box.halfHeight, target: this.world.soul.pos, speed: px(180), count: 3, spread: 0.3 }),
      FIVE: () => ring(this.world.pool, { x: 0, y: 0, count: 10, speed: px(60), radius: px(20), style: { shape: 'rect', a: px(10), b: px(4), spin: 3 } }),
      SIX: () => this.fireSplitBeams(),
      SEVEN: () => ring(this.world.pool, { x: 0, y: 0, count: 12, speed: px(70), radius: px(25), style: { a: px(6), kind: 'kr', damage: 15 } }),
      EIGHT: () => ring(this.world.pool, { x: 0, y: 0, count: 8, speed: px(110), radius: px(20), style: { shape: 'triangle', a: px(8), spin: 2, lifetime: 6, onWall: () => 'bounce' } }),
      // One slow bullet of each projectile type, left to right: white, blue, orange, KR.
      NINE: () =>
        PROJECTILE_TYPES.forEach((kind, i) =>
          this.world.pool.spawn({
            shape: 'circle', kind, a: px(10), damage: 8,
            x: (i - 1.5) * (this.world.box.halfWidth / 2), y: -this.world.box.halfHeight - px(20), vy: px(40),
          }),
        ),
      ZERO: () => this.stress(),
    };
    for (const [key, fn] of Object.entries(fire)) kb.on(`keydown-${key}`, fn);
    kb.on('keydown-C', () => this.world.pool.clear());
    kb.on('keydown-I', () => (this.invincible = !this.invincible));
    kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
    kb.on('keydown-BACKTICK', () => this.scene.start('Battle'));
    // Always the soul's box (it changes when the box is ripped apart or merged).
    const W = this.world;
    const box_: Record<string, () => void> = {
      Q: () => W.box.rotateBy(-Math.PI / 6, 0.4),
      E: () => W.box.rotateBy(Math.PI / 6, 0.4),
      R: () => W.box.rotateBy(Math.PI / 2, 0.5),
      T: () => W.box.rotateBy(Math.PI, 0.8),
      F: () => {
        this.small = !this.small;
        const d = W.home;
        W.box.resizeTo(this.small ? px(180) : d.width, this.small ? px(120) : d.height, 0.6);
      },
      G: () => {
        const d = W.home;
        const offs = [[60, -30], [-60, 30], [0, 0]] as const;
        const [ox, oy] = offs[this.moveIdx++ % offs.length]!;
        W.box.moveTo(d.x + px(ox), d.y + px(oy), 0.6);
      },
      V: () => W.box.squeezeWall('left', px(80), 0.12),
      B: () => W.box.squeezeWall('right', px(80), 1.5),
      N: () => this.cycleWalls(),
      M: () => (this.chaos = !this.chaos),
      P: () => this.prism.setLevel(this.prism.level === 20 ? 0 : 20),
      J: () => this.mortimer.fireNow('snowfall', 20),
      K: () => this.mortimer.fireNow('roll', 20),
      L: () => this.mortimer.fireNow('blizzard', 20),
      U: () => this.ulysses.fireNow('summon', 20),
      Y: () => this.ulysses.fireNow('axe', 20),
      O: () => this.ulysses.fireNow('rain', 20),
      COMMA: () => this.warden.fireNow('punch', 20),
      FORWARD_SLASH: () => this.warden.fireNow('spin', 20),
      // Rip and merge on demand (level 20 params): [ rips the box apart, ] punches the left half
      // into the right (merge, offset), BACKSLASH punches the merged box back to center.
      OPEN_BRACKET: () => this.warden.ripNow(this.wardenParams('rip')),
      CLOSED_BRACKET: () => this.warden.mergeNow(this.wardenParams('rip'), 0),
      BACK_SLASH: () => this.warden.recenterNow(this.wardenParams('rip')),
      X: () => this.prismCombo(),
      PERIOD: () => {
        this.blizzard = !this.blizzard;
        const phase = this.blizzard ? 'blizzard' : 'breather';
        this.world.bus.emit('mortimerPhaseChanged', { owner: 'mortimer', phase, next: 'blizzard' });
        if (this.blizzard) this.ulysses.fireNow('summon', 20);
      },
      Z: () => {
        this.chaos = false;
        this.small = false;
        W.resetBoxes();
        W.box.reset();
      },
    };
    for (const [key, fn] of Object.entries(box_)) kb.on(`keydown-${key}`, fn);

    (window as unknown as Record<string, unknown>).__debug = {
      world: this.world, view: this.view, loop: this.loop, game: this.game, fire, box: box_,
      setChaos: (v: boolean) => (this.chaos = v),
      prism: () => this.prism,
      mortimer: () => this.mortimer,
      ulysses: () => this.ulysses,
      warden: () => this.warden,
      prismCombo: () => this.prismCombo(),
      setInvincible: (v: boolean) => (this.invincible = v),
    };
  }

  /** Prism + Ulysses demo: a refraction prism at the center and one white sword flying through it. */
  private prismCombo(): void {
    const w = this.world;
    if (!w.props.some((p) => p.refracts)) {
      w.props.push({ shape: 'triangle', x: 0, y: 0, r: px(28), rotation: -Math.PI / 2, color: theme.prismProp, refracts: true });
    }
    w.pool.spawn({
      shape: 'composite', form: SWORD_FORM, a: 0, x: -w.box.halfWidth - px(40), y: 0, vx: px(180), faceVelocity: true,
      damage: 10, owner: 'ulysses', kind: 'white', noPop: true, flags: SWORD_FLAGS.sword,
    });
  }

  /** none -> all walls normal damage -> left/right KR -> none */
  private cycleWalls(): void {
    this.wallMode = (this.wallMode + 1) % 3;
    const b = this.world.box;
    for (const w of WALLS) {
      const damaging = this.wallMode === 1 || (this.wallMode === 2 && (w === 'left' || w === 'right'));
      b.setWall(w, { damaging, damage: this.wallMode === 2 ? 10 : WALL_DAMAGE, type: this.wallMode === 2 ? 'kr' : 'normal' });
    }
  }

  /** Continuous motion for testing: rotate and breathe the size on a loop. */
  private stepChaos(dt: number): void {
    if (!this.chaos) return;
    this.chaosT += dt;
    const b = this.world.box;
    if (this.chaosT >= 1) {
      this.chaosT -= 1;
      b.rotateBy(0.35, 1, 'linear');
      const d = b.defaults;
      const k = 0.65 + 0.35 * Math.abs(Math.sin(this.world.time * 0.7));
      b.resizeTo(d.width * k, d.height * (1.3 - k * 0.3), 1, 'sineInOut');
    }
  }

  private fireLine(): void {
    const edges: Wall[] = ['left', 'top', 'right', 'bottom'];
    const edge = edges[this.edgeIdx++ % 4]!;
    line(this.world.pool, this.world.box, { edge, count: 10, speed: px(110), gaps: [4, 5] });
  }

  /** Demonstrates the wall hook: beams split into two at the wall they hit (a generic hook demo; Prism no longer splits). */
  private fireSplitBeams(): void {
    const w = this.world;
    for (const angle of [-0.6, 0, 0.6]) {
      w.pool.spawn({
        shape: 'beam', x: 0, y: 0, vx: Math.cos(angle) * px(160), vy: Math.sin(angle) * px(160),
        faceVelocity: true, a: px(26), b: px(4), damage: 6,
        onWall: (b, wall, ctx) => {
          if (b.owner === 'child') return 'die';
          const vertical = wall === 'left' || wall === 'right';
          for (const s of [-1, 1]) {
            const vx = vertical ? -b.vx * 0.8 : b.vx * 0.8 + s * px(60);
            const vy = vertical ? b.vy * 0.8 + s * px(60) : -b.vy * 0.8;
            ctx.spawn({
              shape: 'beam', x: b.x, y: b.y, vx, vy, faceVelocity: true,
              a: px(18), b: px(3), damage: 5, owner: 'child', noPop: true,
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
        shape, x: Math.cos(a) * px(20), y: Math.sin(a) * px(20),
        vx: Math.cos(a) * px(20 + (i % 13) * 4), vy: Math.sin(a) * px(20 + (i % 13) * 4),
        a: shape === 'beam' ? px(16) : px(4), b: px(2), spin: 1.5, damage: 1,
      });
    }
  }

  private wardenParams(id: 'rip') {
    return resolveLevel(wardenConfig, 20).attacks[id]!;
  }

  update(): void {
    const w = this.world;
    this.loop.frame((input, dt) => {
      if (this.invincible) w.soul.iframes = Math.max(w.soul.iframes, 2 * STEP);
      this.stepChaos(dt);
      this.prism.tick(dt);
      this.warden.tick(dt);
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
        `hp ${Math.ceil(w.soul.hp)}  kr ${w.soul.kr.toFixed(1)}  ${this.invincible ? 'INVINCIBLE' : ''}  prism lv ${this.prism.level} (P)`,
    );
    const b = w.box;
    const walls = WALLS.map((k) => `${k[0]!.toUpperCase()}:${b.walls[k].damaging ? (b.walls[k].type === 'kr' ? 'KR' : 'DMG') : 'safe'}`).join(' ');
    this.boxText.setText(
      `box ${b.width.toFixed(0)}x${b.height.toFixed(0)} at (${b.x.toFixed(0)},${b.y.toFixed(0)}) rot ${((b.rotation * 180) / Math.PI).toFixed(1)}°` +
        `${b.moving ? ' MOVING' : ''}${this.chaos ? ' CHAOS' : ''}
walls ${walls}`,
    );
  }
}
