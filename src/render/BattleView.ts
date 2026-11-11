import Phaser from 'phaser';
import type { World } from '../core/World';
import type { Vec2 } from '../core/Box';
import { Bullet, bulletCircle, bulletRect, bulletTriangle, rectCorners } from '../combat/Bullet';
import type { Circle, Rect, Triangle } from '../combat/Collision';
import { rgb, theme, toCss } from './theme';
import {
  BOX_BORDER,
  DESPAWN_FADE_TIME,
  HIT_FLASH_MS,
  HIT_SHAKE_INTENSITY,
  HIT_SHAKE_MS,
  IFRAME_BLINK_PERIOD,
} from '../tuning';

const GHOSTS = 256;

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
  private readonly maskGfx: Phaser.GameObjects.Graphics;
  private readonly hpLabel: Phaser.GameObjects.Text;
  private readonly hpValue: Phaser.GameObjects.Text;
  /** Visual-only despawn fades. Plain Bullet objects reused as snapshots; never in the pool, never collide. */
  private readonly ghosts: { b: Bullet; t: number; live: boolean }[] = Array.from({ length: GHOSTS }, () => ({
    b: new Bullet(),
    t: 0,
    live: false,
  }));
  private ghostNext = 0;
  private lastHitSeen = -1;
  showHitboxes = false;

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
    this.maskGfx = scene.make.graphics({}, false);
    this.bulletGfx.setMask(this.maskGfx.createGeometryMask());
    const font = { fontFamily: 'monospace', fontSize: '14px', color: toCss(theme.text) };
    this.hpLabel = scene.add.text(0, 0, 'HP', font);
    this.hpValue = scene.add.text(0, 0, '', font);
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
    b.type = src.type;
    b.color = src.color;
    b.noPop = true;
    g.t = 0;
    g.live = true;
  }

  private colorOf(b: Bullet): number {
    return b.type === 'kr' ? theme.bulletKr : b.color || theme.bulletNormal;
  }

  /** Puts a bullet's exact shape in world space. Returns vertex count in `w`, or 0 for a circle (center tmp, radius c.r). */
  private shapeWorld(b: Bullet): number {
    const box = this.world.box;
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

  draw(realDt: number): void {
    const { box, soul, pool } = this.world;
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
    g.lineStyle(BOX_BORDER, theme.boxBorder, 1);
    this.path(g, 4);
    g.strokePath();
    this.maskGfx.clear();
    this.maskGfx.fillStyle(0xffffff, 1);
    this.path(this.maskGfx, 4);
    this.maskGfx.fillPath();

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
    for (const b of pool.all) if (b.active) this.fillBullet(bg, b, 1);

    // Soul: solid circle, drawn radius == hit radius. Blinks during i-frames.
    const sg = this.soulGfx;
    sg.clear();
    const sw = box.toWorld(soul.pos, this.tmp);
    const blinkOff = soul.invulnerable && Math.floor(soul.iframes / IFRAME_BLINK_PERIOD) % 2 === 0;
    if (soul.alive && !blinkOff) {
      sg.fillStyle(theme.soul, 1);
      sg.fillCircle(sw.x, sw.y, soul.hitRadius);
    }

    // Hit feedback: brief flash + small shake.
    if (this.world.lastHitStep !== this.lastHitSeen) {
      this.lastHitSeen = this.world.lastHitStep;
      const cam = this.scene.cameras.main;
      cam.shake(HIT_SHAKE_MS, HIT_SHAKE_INTENSITY);
      const [r, gr, b] = rgb(theme.hitFlash);
      cam.flash(HIT_FLASH_MS, r, gr, b, true);
    }

    this.drawOverlay();
    this.drawHud();
  }

  /** Dev: outline every collision shape, computed through the collision geometry. */
  private drawOverlay(): void {
    const og = this.overlayGfx;
    og.clear();
    if (!this.showHitboxes) return;
    const { box, soul, pool } = this.world;
    og.lineStyle(1, theme.hitboxOutline, 1);
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

  private drawHud(): void {
    const { box, soul } = this.world;
    const barW = 160;
    const barH = 12;
    const bx = box.x - barW / 2;
    const by = box.y + box.halfHeight + 22;
    const hp = Math.max(0, soul.hp);
    const px = barW / soul.maxHp;
    const g = this.hudGfx;
    g.clear();
    g.fillStyle(theme.hpEmpty, 1);
    g.fillRect(bx, by, barW, barH);
    g.fillStyle(theme.hpFill, 1);
    g.fillRect(bx, by, (hp - soul.kr) * px, barH);
    if (soul.kr > 0) {
      g.fillStyle(theme.kr, 1);
      g.fillRect(bx + (hp - soul.kr) * px, by, soul.kr * px, barH);
    }
    this.hpLabel.setPosition(bx - 30, by - 2);
    this.hpValue.setPosition(bx + barW + 10, by - 2);
    this.hpValue.setText(`${Math.ceil(hp)} / ${soul.maxHp}${soul.kr > 0 ? ' KR' : ''}`);
    this.hpValue.setColor(toCss(soul.kr > 0 ? theme.kr : theme.text));
  }
}
