import Phaser from 'phaser';
import type { World } from '../core/World';
import type { Vec2, Wall } from '../core/Box';
import { Bullet, bulletExtent, rectCorners, sinceArmed } from '../combat/Bullet';
import { bulletPrimitives, RING_TONGUES, ringTongue, type Primitive } from '../combat/composite';
import type { Circle } from '../combat/Collision';
import { hud, line, rgb, theme, VIEW } from './theme';
import { renderScale } from './display';
import { BLINK_FLASH_TIME, px, SLOWTIME_DURATION, SOUL_RADIUS } from '../tuning';
import { settings } from '../settings/store';
import { Shield } from '../abilities/actives/Shield';
import { SlowTime } from '../abilities/actives/SlowTime';
import { Blink } from '../abilities/actives/Blink';

/** Shield bubble: gap from the soul's edge (px), ring line width, break burst time (s). */
const SHIELD_GAP = 7;
const SHIELD_LINE = 2;
const SHIELD_BREAK_FX = 0.25;
import { BoxFrame, interpBullet, lerpPoint } from './interp';
import { flashScreen, shakeScreen, shineShape } from './effects';
import { LookCache, type Look } from './LookCache';
import type { LookSpec } from '../characters/Character';
import {
  DESPAWN_FADE_TIME,
  HIT_FLASH_MS,
  HIT_SHAKE_INTENSITY,
  HIT_SHAKE_MS,
  LAND_SHAKE_INTENSITY,
  LAND_SHAKE_MS,
  IFRAME_BLINK_PERIOD,
  DASH_DURATION,
  DASH_TRAIL_FADE,
  SHINE_TIME,
} from '../tuning';
import { Dash } from '../abilities/actives/Dash';
import { STEP } from '../core/Clock';

const GHOSTS = 256;
/** Shine ring texture buckets: radius rounded up to powers of this (the sprite scales to the exact radius). */
const RING_BUCKET = 1.04;
const ringExp = (r: number): number => Math.ceil(Math.log(Math.max(0.5, r)) / Math.log(RING_BUCKET) - 1e-9);
const ringOf = (k: number): number => Number(Math.pow(RING_BUCKET, k).toFixed(3));
const ringBucket = (r: number): number => ringOf(ringExp(r));

/**
 * A pool of Phaser images at one depth, reused every frame: `begin`, then `next(look)` per thing
 * drawn (positioned/rotated/scaled/tinted by the caller), then `end` hides the rest. Images are
 * only ever created when a frame needs more than before, never per frame.
 */
class SpriteLayer {
  private readonly items: Phaser.GameObjects.Image[] = [];
  private used = 0;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}
  begin(): void {
    this.used = 0;
  }
  next(look: Look): Phaser.GameObjects.Image {
    let img = this.items[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, look.key).setDepth(this.depth);
      this.items.push(img);
    } else if (img.texture.key !== look.key) {
      img.setTexture(look.key);
    }
    this.used++;
    img.setVisible(true).setOrigin(look.ox, look.oy).setAlpha(1);
    return img;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) {
      const img = this.items[i]!;
      if (img.visible) img.setVisible(false);
    }
  }
  /**
   * The cache is rebuilding its textures under the same keys: drop every reference to the old
   * (destroyed) ones, so `next` re-binds each image to the new texture.
   */
  reset(): void {
    for (const img of this.items) img.setTexture('__DEFAULT').setVisible(false);
  }
}
/** Wall -> indices into the box corner list [TL, TR, BR, BL]. */
const WALL_EDGES: readonly [Wall, number, number][] = [
  ['top', 0, 1],
  ['right', 1, 2],
  ['bottom', 2, 3],
  ['left', 3, 0],
];

/**
 * Draws a World: flat solid shapes, crisp edges. Every bullet look (shape/composite and size; gold
 * or white is just the tint) is rasterised ONCE into a cached white texture at the current render
 * resolution (LookCache) from the same primitives collision uses, and drawn as pooled sprites that
 * are positioned, rotated, scaled and tinted each frame. The soul, dash trail, props, shines, walls
 * and ray glows are cached looks too. Only the box fill, HUD bars and the dev overlays are Graphics
 * (axis-aligned or debug). The hitbox overlay still strokes the true collision primitives directly.
 */
export class BattleView {
  private readonly boxGfx: Phaser.GameObjects.Graphics;
  private readonly overlayGfx: Phaser.GameObjects.Graphics;
  private readonly hudGfx: Phaser.GameObjects.Graphics;
  readonly looks: LookCache;
  private readonly walls: SpriteLayer;
  private readonly ghostGlows: SpriteLayer;
  private readonly ghostSprites: SpriteLayer;
  private readonly propSprites: SpriteLayer;
  private readonly glowSprites: SpriteLayer;
  private readonly bulletSprites: SpriteLayer;
  private readonly shineSprites: SpriteLayer;
  private readonly soulSprites: SpriteLayer;
  private readonly layers: SpriteLayer[];
  /** Visual-only despawn fades. Plain Bullet objects reused as snapshots; never in the pool, never collide. */
  private readonly ghosts: { b: Bullet; t: number; live: boolean }[] = Array.from({ length: GHOSTS }, () => ({
    b: new Bullet(),
    t: 0,
    live: false,
  }));
  private ghostNext = 0;
  private lastHitSeen = -1;
  private landed = false;
  showHitboxes = false;
  /** Box geometry being drawn this frame (interpolated). All drawing transforms go through it. */
  private readonly frame = new BoxFrame();
  /** Scratch bullet holding a bullet's interpolated drawable state. Never in the pool, never collides. */
  private readonly ib = new Bullet();

  // Scratch objects: no per-frame allocation.
  private readonly c: Circle = { x: 0, y: 0, r: 0 };
  private readonly pts: Vec2[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private readonly w: Vec2[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly tmp2: Vec2 = { x: 0, y: 0 };
  private readonly tmp3: Vec2 = { x: 0, y: 0 };
  /** Template for ring flame-tongue looks (a composite bullet whose form is set per tongue). */
  private readonly tongueTpl = new Bullet().init({ shape: 'composite', a: 0, x: 0, y: 0, damage: 0 });

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    // Draw order = depth: box, walls, ghosts, props, glows, bullets, shines, soul (+ trail), overlay, HUD.
    this.looks = new LookCache(scene);
    // A tossed box lands heavily: a short shake on the next frame (through the effects gate).
    world.bus.on('boxLanded', () => (this.landed = true));
    this.boxGfx = scene.add.graphics().setDepth(0);
    this.walls = new SpriteLayer(scene, 1);
    this.ghostGlows = new SpriteLayer(scene, 2);
    this.ghostSprites = new SpriteLayer(scene, 3);
    this.propSprites = new SpriteLayer(scene, 4);
    this.glowSprites = new SpriteLayer(scene, 5);
    this.bulletSprites = new SpriteLayer(scene, 6);
    this.shineSprites = new SpriteLayer(scene, 7);
    this.soulSprites = new SpriteLayer(scene, 8);
    this.overlayGfx = scene.add.graphics().setDepth(9);
    this.hudGfx = scene.add.graphics().setDepth(10);
    this.layers = [this.walls, this.ghostGlows, this.ghostSprites, this.propSprites, this.glowSprites, this.bulletSprites, this.shineSprites, this.soulSprites];
    scene.events.once('shutdown', () => this.looks.clear());
    // Bullets are not clipped to the box: attacks are seen arriving from off screen.
    world.pool.onDespawn = (b, reason) => {
      if (reason !== 'cancel') this.addGhost(b);
    };
  }

  private addGhost(src: Bullet): void {
    const g = this.ghosts[this.ghostNext]!;
    this.ghostNext = (this.ghostNext + 1) % GHOSTS;
    const b = g.b;
    b.shape = src.shape;
    b.x = src.x;
    b.y = src.y;
    b.rotation = src.rotation;
    b.a = src.a;
    b.b = src.b;
    b.kind = src.kind;
    b.armed = src.armed; // a pre-active (gold) bullet fades out gold
    b.form = src.form;
    b.glow = src.glow;
    b.decor = src.decor;
    b.tint = src.tint;
    b.growIn = false;
    b.noPop = true;
    g.t = 0;
    g.live = true;
  }

  /** Type color once active; pre-active bullets are gold (harmless warning). */
  private colorOf(b: Bullet): number {
    return b.armed ? theme.bullet[b.kind] : theme.preActive;
  }

  /**
   * Puts one primitive of a bullet's exact shape in world space. Returns the vertex count in `w`,
   * or 0 for a circle (center tmp, radius c.r).
   */
  private primWorld(p: Primitive): number {
    const box = this.frame;
    if (p.kind === 'circle') {
      this.c.r = p.c.r;
      box.toWorld(p.c, this.tmp);
      return 0;
    }
    if (p.kind === 'tri') {
      const t = p.t;
      this.tmp2.x = t.ax; this.tmp2.y = t.ay; box.toWorld(this.tmp2, this.w[0]);
      this.tmp2.x = t.bx; this.tmp2.y = t.by; box.toWorld(this.tmp2, this.w[1]);
      this.tmp2.x = t.cx; this.tmp2.y = t.cy; box.toWorld(this.tmp2, this.w[2]);
      return 3;
    }
    rectCorners(p.r, this.pts);
    for (let i = 0; i < 4; i++) box.toWorld(this.pts[i]!, this.w[i]);
    return 4;
  }

  private path(g: Phaser.GameObjects.Graphics, n: number): void {
    g.beginPath();
    g.moveTo(this.w[0]!.x, this.w[0]!.y);
    for (let i = 1; i < n; i++) g.lineTo(this.w[i]!.x, this.w[i]!.y);
    g.closePath();
  }

  /**
   * Draw one bullet (already interpolated) as a sprite of its cached look, plus its glow sprite
   * (decorative, never part of the hitbox: CLAUDE.md). Position/rotation follow the drawn box frame;
   * the bullet's scale (spawn pop, grow-in) and circle size buckets are sprite scale.
   */
  private drawBullet(core: SpriteLayer, glowLayer: SpriteLayer, b: Bullet, alpha: number): void {
    const box = this.frame;
    const p = box.toWorld(b, this.tmp);
    const rot = box.rotation + b.rotation;
    const s = b.scale;
    // Fade into existence at full size (visual only; the hitbox is full size from the first step).
    alpha *= b.fadeAlpha * b.flickerAlpha;
    if (b.decor) {
      // An object, not a projectile (The Warden's fists): earthy fill plus a lighter rocky edge.
      const fill = this.looks.bullet(b);
      const fi = this.propSprites.next(fill).setPosition(p.x, p.y).setRotation(rot).setScale(s / fill.k).setTint(b.tint);
      const edge = this.looks.edge(b);
      const ei = this.propSprites.next(edge).setPosition(p.x, p.y).setRotation(rot).setScale(s / edge.k).setTint(b.edgeTint >= 0 ? b.edgeTint : theme.wardenFistEdge);
      if (alpha < 1) {
        fi.setAlpha(alpha);
        ei.setAlpha(alpha);
      }
      return;
    }
    const color = this.colorOf(b);
    if (b.glow) {
      const g = this.looks.glow(b);
      glowLayer.next(g).setPosition(p.x, p.y).setRotation(rot).setScale(s / g.k).setTint(color).setAlpha(theme.glowAlpha * alpha);
    }
    if (b.shape === 'ring') {
      // The same chord rects collision uses (bulletPrimitives), each a stretched line look.
      const look = this.looks.line(b.b);
      bulletPrimitives(b, (q) => {
        if (q.kind !== 'rect') return;
        const c = box.toWorld(q.r, this.tmp3);
        const img = core.next(look).setPosition(c.x, c.y).setRotation(box.rotation + (q.r.rotation ?? 0)).setScale((2 * q.r.hw) / look.size, 1 / look.k).setTint(color);
        if (alpha < 1) img.setAlpha(alpha);
      });
      // Flame tongues: the same triangles collision uses (ringTongue), as cached tongue looks.
      const tpl = this.tongueTpl;
      for (let i = 0; i < RING_TONGUES; i++) {
        const tg = ringTongue(b, i);
        tpl.form = tg.form;
        const tl = this.looks.bullet(tpl);
        const c = box.toWorld(tg, this.tmp3);
        const img = core.next(tl).setPosition(c.x, c.y).setRotation(box.rotation + tg.rot).setScale(1 / tl.k).setTint(color);
        if (alpha < 1) img.setAlpha(alpha);
      }
      return;
    }
    const look = this.looks.bullet(b);
    const k = b.shape === 'circle' ? (s * b.a) / look.size : s;
    const img = core.next(look).setPosition(p.x, p.y).setRotation(rot).setScale(k / look.k).setTint(color);
    if (alpha < 1) img.setAlpha(alpha);
  }

  /**
   * Looks the active roster can produce (set by the battle scene from each character's
   * `lookSpecs`). Every one is rasterised up front, behind the scene fade, and again whenever the
   * render scale changes, so no texture is built mid-battle.
   */
  private warmSpecs: readonly LookSpec[] = [];
  /** Texture builds done by the last prewarm (diagnostics: `looks.built - warmBuilt` = built since). */
  warmBuilt = 0;

  setPrewarm(specs: readonly LookSpec[]): void {
    this.warmSpecs = specs;
    this.prewarm();
  }

  /** Build every known look now (no-op for ones already cached). */
  prewarm(): void {
    const scale = renderScale();
    if (this.looks.sync(scale)) for (const l of this.layers) l.reset();
    const t = this.ib;
    const lk = this.looks;
    lk.disc(SOUL_RADIUS);
    // Ability visuals: the bubble ring and every ring bucket the break burst and blink ring pass through.
    lk.ring(SOUL_RADIUS + SHIELD_GAP, SHIELD_LINE);
    for (let k = ringExp(SOUL_RADIUS); k <= ringExp((SOUL_RADIUS + SHIELD_GAP) * 2.7) + 1; k++) lk.ring(ringOf(k), SHIELD_LINE);
    lk.line(line.box);
    lk.line(line.danger);
    for (const spec of this.warmSpecs) {
      if (spec.prop) {
        lk.prop(spec.prop, theme.propFillAlpha, 1.5, 0.9);
        continue;
      }
      t.shape = spec.shape!;
      t.form = spec.form ?? null;
      t.b = spec.b ?? spec.a ?? 0;
      const radii = spec.radii ?? [spec.a ?? 0];
      for (const a of radii) {
        t.a = a;
        if (spec.decor) lk.edge(t);
        lk.bullet(t);
        if (spec.glow) lk.glow(t);
        if (spec.shine) {
          // Shine rings: radius rounded to 0.5 px over the whole shine (see draw).
          const e = bulletExtent(t);
          // Every ring bucket the shine passes through (it widens monotonically).
          const w = shineShape(e, 0).ringWidth;
          const k0 = ringExp(shineShape(e, 0).ringR);
          const k1 = ringExp(shineShape(e, 1).ringR);
          for (let k = k0; k <= k1; k++) lk.ring(ringOf(k), w);
        }
      }
    }
    this.warmBuilt = lk.built;
  }

  /** A disc sprite (soul, trail, shine fill) of radius r at world (x, y). */
  private disc(layer: SpriteLayer, x: number, y: number, r: number, color: number, alpha: number): void {
    const look = this.looks.disc(SOUL_RADIUS); // one texture; scaled to r (the soul's radius scales with a tossed box)
    layer.next(look).setPosition(x, y).setScale(r / look.size / look.k).setTint(color).setAlpha(alpha);
  }

  /**
   * Draw the world. `alpha` (0..1) blends each object from its pre-step to its current simulated
   * state (render interpolation). The hitbox overlay forces alpha 1, so with it on the drawn shapes
   * are exactly the collision shapes.
   */
  draw(realDt: number, alpha = 1): void {
    const { soul, pool } = this.world;
    this.clockS += realDt;
    const t = this.showHitboxes ? 1 : Math.min(1, Math.max(0, alpha));
    const box = this.frame.set(this.world.box, t);
    // Every box (two while split): fill under all walls, then walls, each through its own
    // interpolated frame. The soul's box frame (`box`) is what bullets and the soul draw through.
    const g = this.boxGfx;
    g.clear();
    g.fillStyle(theme.boxFill, 1);
    const frames = this.world.boxes.map((bx) => (bx === this.world.box ? box : this.frameOf(bx).set(bx, t)));
    for (const f of frames) {
      this.boxCorners(f);
      this.path(g, 4);
      g.fillPath();
    }
    // Textures follow the render resolution (quality setting, devicePixelRatio, window size).
    if (this.looks.sync(renderScale())) {
      for (const l of this.layers) l.reset();
      this.prewarm();
    }
    for (const l of this.layers) l.begin();

    // Walls: safe = thin white; damaging = thick lime (normal) or magenta (KR). Never red. Cached
    // line looks stretched along each wall (anti-aliased long edges at any rotation).
    this.world.boxes.forEach((bx, i) => {
      this.boxCorners(frames[i]!);
      for (const [wall, a, b] of WALL_EDGES) {
        const ws = bx.walls[wall];
        const p0 = this.w[a]!;
        const p1 = this.w[b]!;
        const width = ws.damaging ? line.danger : line.box;
        const color = ws.damaging ? (ws.type === 'kr' ? theme.kr : theme.wallDamaging) : theme.boxBorder;
        const look = this.looks.line(width);
        const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        this.walls
          .next(look)
          .setPosition((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
          .setRotation(Math.atan2(p1.y - p0.y, p1.x - p0.x))
          .setScale(len / look.size, 1 / look.k)
          .setTint(color);
      }
    });

    // Fast-fading despawn ghosts (visual only).
    for (const gh of this.ghosts) {
      if (!gh.live) continue;
      gh.t += realDt;
      if (gh.t >= DESPAWN_FADE_TIME) {
        gh.live = false;
        continue;
      }
      this.drawBullet(this.ghostSprites, this.ghostGlows, gh.b, 0.6 * (1 - gh.t / DESPAWN_FADE_TIME));
    }
    // Props (non-damaging): translucent fill + thin outline so they never read as solid hazards.
    for (const p of this.world.props) {
      const look = this.looks.prop(p.r, theme.propFillAlpha, 1.5, 0.9);
      const wpos = box.toWorld(p, this.tmp);
      this.propSprites.next(look).setPosition(wpos.x, wpos.y).setRotation(box.rotation + p.rotation).setScale(1 / look.k).setTint(p.color);
    }
    for (const b of pool.all) {
      if (!b.active) continue;
      const ib = interpBullet(b, t, this.ib);
      this.drawBullet(this.bulletSprites, this.glowSprites, ib, 1);
      // Shine: the gold -> active moment (gameplay cue; see effects.shineShape).
      const s = b.armAt > 0 && !b.noShine ? sinceArmed(b) : -1;
      if (s >= 0 && s < SHINE_TIME) {
        const c = box.toWorld(ib, this.tmp2);
        const sh = shineShape(bulletExtent(b), s / SHINE_TIME);
        this.disc(this.shineSprites, c.x, c.y, sh.fillR, theme.shine, sh.fillAlpha);
        // Ring radius in buckets of RING_BUCKET (a few textures per shine), scaled to the exact radius.
        const ring = this.looks.ring(ringBucket(sh.ringR), sh.ringWidth);
        this.shineSprites.next(ring).setPosition(c.x, c.y).setScale(sh.ringR / ring.size / ring.k).setTint(theme.shine).setAlpha(sh.ringAlpha);
      }
    }

    // Soul: solid circle, drawn radius == hit radius. Blinks during i-frames.
    const sl = lerpPoint(soul.prev.x, soul.prev.y, soul.pos.x, soul.pos.y, t, this.tmp2);
    this.drawTrail(sl, t);
    this.drawAbilityFx(sl, t);
    const sw = box.toWorld(sl, this.tmp);
    const blinkOff = soul.invulnerable && Math.floor(soul.iframes / IFRAME_BLINK_PERIOD) % 2 === 0;
    if (soul.alive && !blinkOff) this.disc(this.soulSprites, sw.x, sw.y, soul.hitRadius, theme.soul, 1);
    for (const l of this.layers) l.end();

    // Hit feedback: brief flash + small shake.
    if (this.world.lastHitStep !== this.lastHitSeen) {
      this.lastHitSeen = this.world.lastHitStep;
      const cam = this.scene.cameras.main;
      // Through the effects gate, so the Settings toggles apply.
      shakeScreen(cam, HIT_SHAKE_MS, HIT_SHAKE_INTENSITY);
      const [r, gr, b] = rgb(theme.hitFlash);
      flashScreen(cam, HIT_FLASH_MS, r, gr, b);
    }

    if (this.landed) {
      this.landed = false;
      shakeScreen(this.scene.cameras.main, LAND_SHAKE_MS, LAND_SHAKE_INTENSITY);
    }

    this.drawOverlay();
    this.drawHud();
  }

  /**
   * Dash trail: a short row of translucent soul-colored circles from the dash start to the soul,
   * shrinking toward the start, fading out after the dash. Visual only.
   */
  private drawTrail(soulLocal: Vec2, t: number): void {
    const ab = this.world.ability;
    if (!(ab instanceof Dash)) return;
    // Age at the drawn moment (the sim is up to one step ahead).
    const age = ab.age - (1 - t) * STEP;
    if (age < 0 || age > DASH_DURATION + DASH_TRAIL_FADE) return;
    const fade = age <= DASH_DURATION ? 1 : 1 - (age - DASH_DURATION) / DASH_TRAIL_FADE;
    const r = this.world.soul.hitRadius;
    const N = 6;
    const p = this.pts[0]!;
    for (let i = 0; i < N; i++) {
      const k = i / N;
      p.x = ab.from.x + (soulLocal.x - ab.from.x) * k;
      p.y = ab.from.y + (soulLocal.y - ab.from.y) * k;
      const w = this.frame.toWorld(p, this.w[0]);
      this.disc(this.soulSprites, w.x, w.y, r * (0.45 + 0.55 * k), theme.soul, 0.35 * fade * (0.3 + 0.7 * k));
    }
  }

  /**
   * Active ability visuals, all from cached looks. The shield bubble is gameplay information (always
   * drawn); the shield break burst, the slow-time tint and the blink flash are purely cosmetic and
   * follow the flash setting (Settings: screen effects).
   */
  private drawAbilityFx(soulLocal: Vec2, t: number): void {
    const ab = this.world.ability;
    if (!ab) return;
    const cosmetic = settings.current.flash;
    const sw = this.frame.toWorld(soulLocal, this.w[1]);
    const R = SOUL_RADIUS + SHIELD_GAP;
    if (ab instanceof Shield) {
      if (ab.active) {
        // Bubble: faint fill plus a ring; it thins and blinks in its last half second.
        const warn = ab.left < 0.5 && Math.floor(ab.left * 10) % 2 === 0;
        this.disc(this.soulSprites, sw.x, sw.y, R, theme.shield, 0.16);
        const ring = this.looks.ring(R, SHIELD_LINE);
        this.soulSprites.next(ring).setPosition(sw.x, sw.y).setScale(1 / ring.k).setTint(theme.shield).setAlpha(warn ? 0.45 : 0.95);
      } else if (ab.ended && ab.endedAge < SHIELD_BREAK_FX && (ab.ended === 'expired' || cosmetic)) {
        // Break: the ring bursts outward and fades (expiry: a short quiet fade in place).
        const k = ab.endedAge / SHIELD_BREAK_FX;
        const r = ab.ended === 'broke' ? R * (1 + 1.6 * k) : R;
        const ring = this.looks.ring(ringBucket(r), SHIELD_LINE);
        this.shineSprites.next(ring).setPosition(sw.x, sw.y).setScale(r / ring.size / ring.k).setTint(theme.shield).setAlpha((ab.ended === 'broke' ? 0.9 : 0.5) * (1 - k));
      }
    } else if (ab instanceof SlowTime && ab.active && cosmetic) {
      // A cool tint over the whole view, from the stretched line look (fades in and out quickly).
      const look = this.looks.line(line.box);
      const edge = Math.min(1, (SLOWTIME_DURATION - ab.left) / 0.15, ab.left / 0.25);
      this.shineSprites.next(look).setPosition(VIEW.cx, VIEW.cy).setRotation(0)
        .setScale((VIEW.width + 8) / look.size, (VIEW.height + 8) / (line.box * look.k) * 1.0)
        .setTint(theme.slowTint).setAlpha(theme.slowTintAlpha * edge);
    } else if (ab instanceof Blink && ab.age < BLINK_FLASH_TIME && cosmetic) {
      // A puff where it left and a ring where it landed, fading.
      const k = Math.max(0, ab.age) / BLINK_FLASH_TIME;
      const a = this.frame.toWorld(ab.from, this.w[2]);
      this.disc(this.shineSprites, a.x, a.y, SOUL_RADIUS * (1 - 0.5 * k), theme.blink, 0.7 * (1 - k));
      const r = SOUL_RADIUS * (1.2 + 1.4 * k);
      const ring = this.looks.ring(ringBucket(r), SHIELD_LINE);
      const b = this.frame.toWorld(ab.to, this.w[3]);
      this.shineSprites.next(ring).setPosition(b.x, b.y).setScale(r / ring.size / ring.k).setTint(theme.blink).setAlpha(0.85 * (1 - k));
    }
    void t;
  }

  /** Interpolation frames for boxes other than the soul's (split boxes). */
  private readonly frames = new WeakMap<object, BoxFrame>();
  private frameOf(b: object): BoxFrame {
    let f = this.frames.get(b);
    if (!f) this.frames.set(b, (f = new BoxFrame()));
    return f;
  }

  /** A box frame's four corners in world space, into `this.w` [TL, TR, BR, BL]. */
  private boxCorners(f: BoxFrame): void {
    const hw = f.halfWidth, hh = f.halfHeight;
    this.pts[0]!.x = -hw; this.pts[0]!.y = -hh;
    this.pts[1]!.x = hw; this.pts[1]!.y = -hh;
    this.pts[2]!.x = hw; this.pts[2]!.y = hh;
    this.pts[3]!.x = -hw; this.pts[3]!.y = hh;
    for (let i = 0; i < 4; i++) f.toWorld(this.pts[i]!, this.w[i]);
  }

  /** Dev: outline every collision shape, computed through the collision geometry. */
  private drawOverlay(): void {
    const og = this.overlayGfx;
    og.clear();
    if (this.showBands) {
      og.fillStyle(theme.hudBand, 0.16);
      for (const b of [hud.top, hud.bottom]) og.fillRect(0, b.y, VIEW.width, b.height);
    }
    if (!this.showHitboxes) return;
    const { soul, pool } = this.world;
    const box = this.frame; // equals the simulated box: alpha is forced to 1 while the overlay is on
    // Hairline: 1 device pixel, so it shows exactly where the shape edge is at any zoom.
    og.lineStyle(1 / renderScale(), theme.hitboxOutline, 1);
    for (const b of pool.all) {
      // Decor objects (fists) never collide, so they have no hitbox to outline.
      if (!b.active || b.decor) continue;
      // Through the collision primitives (composites part by part); glows are never outlined.
      bulletPrimitives(b, (p) => {
        const n = this.primWorld(p);
        if (n === 0) og.strokeCircle(this.tmp.x, this.tmp.y, this.c.r);
        else {
          this.path(og, n);
          og.strokePath();
        }
      });
    }
    const sw = box.toWorld(soul.pos, this.tmp);
    og.strokeCircle(sw.x, sw.y, soul.hitRadius);
    // Every box's walls (the soul is clamped to and touches only its own box's).
    for (const bx of this.world.boxes) {
      this.boxCorners(bx === this.world.box ? box : this.frameOf(bx).set(bx, 1));
      this.path(og, 4);
      og.strokePath();
    }
  }

  /** HP bar rect in the 1280x720 layout: centered in the bottom HUD band (the HTML HUD aligns its text to it). */
  get hpBar(): { x: number; y: number; w: number; h: number } {
    const w = px(160);
    const h = 6;
    return { x: Math.round(VIEW.cx - w / 2), y: Math.round(hud.barY - h / 2), w, h };
  }

  /** Dev: shade the HUD bands (theme.hud) to check by eye that nothing spawns or forms there. */
  showBands = false;

  /** Ability bar rect: same height as the HP bar, to its right past the HP value. */
  get abilityBar(): { x: number; y: number; w: number; h: number } {
    const hp = this.hpBar;
    return { x: hp.x + hp.w + 150, y: hp.y, w: px(60), h: hp.h };
  }

  /** Real time of the last denied press (s); the bar flashes briefly after it. */
  deniedAt = -Infinity;
  private clockS = 0;

  /** Thin HP bar (canvas). Its text lives in the HTML layer. */
  private drawHud(): void {
    const { soul } = this.world;
    const { x: bx, y: by, w: barW, h: barH } = this.hpBar;
    const hp = Math.max(0, soul.hp);
    const k = barW / soul.maxHp;
    const g = this.hudGfx;
    g.clear();
    g.fillStyle(theme.hpEmpty, 1);
    g.fillRect(bx, by, barW, barH);
    g.fillStyle(theme.hpFill, 1);
    g.fillRect(bx, by, (hp - soul.kr) * k, barH);
    if (soul.kr > 0) {
      g.fillStyle(theme.kr, 1);
      g.fillRect(bx + (hp - soul.kr) * k, by, soul.kr * k, barH);
    }
    // Ability bar, built only from the ActiveAbility interface: fills as the cooldown recovers,
    // bright when ready; a denied press flashes the empty part briefly.
    const ab = this.world.ability;
    if (!ab) return;
    const a = this.abilityBar;
    const frac = ab.cooldown > 0 ? 1 - ab.remaining / ab.cooldown : 1;
    const denied = this.clockS - this.deniedAt < 0.18;
    g.fillStyle(denied ? theme.textDim : theme.hpEmpty, 1);
    g.fillRect(a.x, a.y, a.w, a.h);
    g.fillStyle(ab.ready ? theme.abilityReady : theme.abilityCharging, 1);
    g.fillRect(a.x, a.y, a.w * frac, a.h);
  }

  /** Real-time clock for HUD feedback (advanced by draw). */
  get now(): number {
    return this.clockS;
  }
}
