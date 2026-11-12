import Phaser from 'phaser';
import type { World } from '../core/World';
import type { Vec2, Wall } from '../core/Box';
import { Bullet, bulletCircle, bulletExtent, bulletRect, bulletTriangle, rectCorners, sinceArmed } from '../combat/Bullet';
import type { Circle, Rect, Triangle } from '../combat/Collision';
import { hud, line, rgb, theme, VIEW } from './theme';
import { renderScale } from './display';
import { px } from '../tuning';
import { BoxFrame, interpBullet, lerpPoint } from './interp';
import { drawShine, flashScreen, shakeScreen } from './effects';
import {
  DESPAWN_FADE_TIME,
  HIT_FLASH_MS,
  HIT_SHAKE_INTENSITY,
  HIT_SHAKE_MS,
  IFRAME_BLINK_PERIOD,
  DASH_DURATION,
  DASH_TRAIL_FADE,
  SHINE_TIME,
} from '../tuning';
import { Dash } from '../abilities/actives/Dash';
import { STEP } from '../core/Clock';

const GHOSTS = 256;
/** Wall -> indices into the box corner list [TL, TR, BR, BL]. */
const WALL_EDGES: readonly [Wall, number, number][] = [
  ['top', 0, 1],
  ['right', 1, 2],
  ['bottom', 2, 3],
  ['left', 3, 0],
];

/**
 * Draws a World with Phaser Graphics: flat solid shapes, crisp edges, no textures.
 * Bullet geometry comes from the same functions collision uses (combat/Bullet.ts),
 * so drawn shapes and hitboxes cannot drift apart.
 */
export class BattleView {
  private readonly boxGfx: Phaser.GameObjects.Graphics;
  private readonly bulletGfx: Phaser.GameObjects.Graphics;
  private readonly soulGfx: Phaser.GameObjects.Graphics;
  private readonly overlayGfx: Phaser.GameObjects.Graphics;
  private readonly hudGfx: Phaser.GameObjects.Graphics;
  /** Visual-only despawn fades. Plain Bullet objects reused as snapshots; never in the pool, never collide. */
  private readonly ghosts: { b: Bullet; t: number; live: boolean }[] = Array.from({ length: GHOSTS }, () => ({
    b: new Bullet(),
    t: 0,
    live: false,
  }));
  private ghostNext = 0;
  private lastHitSeen = -1;
  showHitboxes = false;
  /** Box geometry being drawn this frame (interpolated). All drawing transforms go through it. */
  private readonly frame = new BoxFrame();
  /** Scratch bullet holding a bullet's interpolated drawable state. Never in the pool, never collides. */
  private readonly ib = new Bullet();

  // Scratch objects: no per-frame allocation.
  private readonly c: Circle = { x: 0, y: 0, r: 0 };
  private readonly r: Rect = { x: 0, y: 0, hw: 0, hh: 0, rotation: 0 };
  private readonly t: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };
  private readonly pts: Vec2[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private readonly w: Vec2[] = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  private readonly tmp: Vec2 = { x: 0, y: 0 };
  private readonly tmp2: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
  ) {
    this.boxGfx = scene.add.graphics();
    this.bulletGfx = scene.add.graphics();
    this.soulGfx = scene.add.graphics();
    this.overlayGfx = scene.add.graphics();
    this.hudGfx = scene.add.graphics();
    // Bullets are not clipped to the box: attacks are seen arriving from off screen.
    world.pool.onDespawn = (b) => this.addGhost(b);
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
    b.growIn = false;
    b.noPop = true;
    g.t = 0;
    g.live = true;
  }

  /** Type color once active; pre-active bullets are gold (harmless warning). */
  private colorOf(b: Bullet): number {
    return b.armed ? theme.bullet[b.kind] : theme.preActive;
  }

  /** Puts a bullet's exact shape in world space. Returns vertex count in `w`, or 0 for a circle (center tmp, radius c.r). */
  private shapeWorld(b: Bullet): number {
    const box = this.frame;
    if (b.shape === 'circle') {
      bulletCircle(b, this.c);
      box.toWorld(this.c, this.tmp);
      return 0;
    }
    if (b.shape === 'triangle') {
      const t = bulletTriangle(b, this.t);
      this.tmp2.x = t.ax; this.tmp2.y = t.ay; box.toWorld(this.tmp2, this.w[0]);
      this.tmp2.x = t.bx; this.tmp2.y = t.by; box.toWorld(this.tmp2, this.w[1]);
      this.tmp2.x = t.cx; this.tmp2.y = t.cy; box.toWorld(this.tmp2, this.w[2]);
      return 3;
    }
    rectCorners(bulletRect(b, this.r), this.pts);
    for (let i = 0; i < 4; i++) box.toWorld(this.pts[i]!, this.w[i]);
    return 4;
  }

  private path(g: Phaser.GameObjects.Graphics, n: number): void {
    g.beginPath();
    g.moveTo(this.w[0]!.x, this.w[0]!.y);
    for (let i = 1; i < n; i++) g.lineTo(this.w[i]!.x, this.w[i]!.y);
    g.closePath();
  }

  private fillBullet(g: Phaser.GameObjects.Graphics, b: Bullet, alpha: number): void {
    const n = this.shapeWorld(b);
    g.fillStyle(this.colorOf(b), alpha);
    if (n === 0) {
      g.fillCircle(this.tmp.x, this.tmp.y, this.c.r);
    } else {
      this.path(g, n);
      g.fillPath();
    }
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
    const hw = box.halfWidth;
    const hh = box.halfHeight;

    // Box: corners local -> world so rotation (Phase 5) just works.
    this.pts[0]!.x = -hw; this.pts[0]!.y = -hh;
    this.pts[1]!.x = hw; this.pts[1]!.y = -hh;
    this.pts[2]!.x = hw; this.pts[2]!.y = hh;
    this.pts[3]!.x = -hw; this.pts[3]!.y = hh;
    for (let i = 0; i < 4; i++) box.toWorld(this.pts[i]!, this.w[i]);
    const g = this.boxGfx;
    g.clear();
    g.fillStyle(theme.boxFill, 1);
    this.path(g, 4);
    g.fillPath();
    // Walls: safe = thin white; damaging = thick lime (normal) or magenta (KR). Never red.
    for (const [wall, a, b] of WALL_EDGES) {
      const ws = this.world.box.walls[wall];
      const p0 = this.w[a]!;
      const p1 = this.w[b]!;
      if (ws.damaging) {
        g.lineStyle(line.danger, ws.type === 'kr' ? theme.kr : theme.wallDamaging, 1);
      } else {
        g.lineStyle(line.box, theme.boxBorder, 1);
      }
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }

    // Bullets, plus fast-fading despawn ghosts.
    const bg = this.bulletGfx;
    bg.clear();
    for (const gh of this.ghosts) {
      if (!gh.live) continue;
      gh.t += realDt;
      if (gh.t >= DESPAWN_FADE_TIME) {
        gh.live = false;
        continue;
      }
      this.fillBullet(bg, gh.b, 0.6 * (1 - gh.t / DESPAWN_FADE_TIME));
    }
    // Props (non-damaging): translucent fill + thin outline so they never read as solid hazards.
    for (const p of this.world.props) {
      const k = (2 * Math.PI) / 3;
      for (let i = 0; i < 3; i++) {
        this.tmp2.x = p.x + Math.cos(p.rotation + i * k) * p.r;
        this.tmp2.y = p.y + Math.sin(p.rotation + i * k) * p.r;
        box.toWorld(this.tmp2, this.w[i]);
      }
      bg.fillStyle(p.color, theme.propFillAlpha);
      this.path(bg, 3);
      bg.fillPath();
      bg.lineStyle(1.5, p.color, 0.9);
      this.path(bg, 3);
      bg.strokePath();
    }
    for (const b of pool.all) {
      if (!b.active) continue;
      const ib = interpBullet(b, t, this.ib);
      this.fillBullet(bg, ib, 1);
      // Shine: the gold -> active moment (gameplay cue; see effects.drawShine).
      const s = b.armAt > 0 ? sinceArmed(b) : -1;
      if (s >= 0 && s < SHINE_TIME) {
        const c = box.toWorld(ib, this.tmp);
        drawShine(bg, c.x, c.y, bulletExtent(b), s / SHINE_TIME, theme.shine);
      }
    }

    // Soul: solid circle, drawn radius == hit radius. Blinks during i-frames.
    const sg = this.soulGfx;
    sg.clear();
    const sl = lerpPoint(soul.prev.x, soul.prev.y, soul.pos.x, soul.pos.y, t, this.tmp2);
    this.drawTrail(sg, sl, t);
    const sw = box.toWorld(sl, this.tmp);
    const blinkOff = soul.invulnerable && Math.floor(soul.iframes / IFRAME_BLINK_PERIOD) % 2 === 0;
    if (soul.alive && !blinkOff) {
      sg.fillStyle(theme.soul, 1);
      sg.fillCircle(sw.x, sw.y, soul.hitRadius);
    }

    // Hit feedback: brief flash + small shake.
    if (this.world.lastHitStep !== this.lastHitSeen) {
      this.lastHitSeen = this.world.lastHitStep;
      const cam = this.scene.cameras.main;
      // Through the effects gate, so the Settings toggles apply.
      shakeScreen(cam, HIT_SHAKE_MS, HIT_SHAKE_INTENSITY);
      const [r, gr, b] = rgb(theme.hitFlash);
      flashScreen(cam, HIT_FLASH_MS, r, gr, b);
    }

    this.drawOverlay();
    this.drawHud();
  }

  /**
   * Dash trail: a short row of translucent soul-colored circles from the dash start to the soul,
   * shrinking toward the start, fading out after the dash. Visual only.
   */
  private drawTrail(g: Phaser.GameObjects.Graphics, soulLocal: Vec2, t: number): void {
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
      g.fillStyle(theme.soul, 0.35 * fade * (0.3 + 0.7 * k));
      g.fillCircle(w.x, w.y, r * (0.45 + 0.55 * k));
    }
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
      if (!b.active) continue;
      const n = this.shapeWorld(b);
      if (n === 0) {
        og.strokeCircle(this.tmp.x, this.tmp.y, this.c.r);
      } else {
        this.path(og, n);
        og.strokePath();
      }
    }
    const sw = box.toWorld(soul.pos, this.tmp);
    og.strokeCircle(sw.x, sw.y, soul.hitRadius);
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
