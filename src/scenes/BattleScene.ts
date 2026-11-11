import Phaser from 'phaser';
import { Box, type Vec2 } from '../core/Box';
import { Clock, STEP } from '../core/Clock';
import { Soul, type DamageType, type MoveInput } from '../core/Soul';
import { circleVsCircle, circleVsRect } from '../combat/Collision';
import { theme, toCss } from '../render/theme';
import { BOX_BORDER, BOX_HEIGHT, BOX_WIDTH, IFRAME_BLINK_PERIOD, SOUL_DRAW_SIZE } from '../tuning';

// ---------------------------------------------------------------------------
// TEMPORARY (Phase 1 only): test bullets + spawner so movement, hits and
// i-frames can be judged by feel. Replaced by combat/Bullet, BulletPool and
// patterns/ in Phase 2. Do not build on this.
// ---------------------------------------------------------------------------
interface TempBullet {
  active: boolean;
  shape: 'circle' | 'rect';
  x: number; // box-local
  y: number;
  vx: number;
  vy: number;
  r: number; // circle radius
  hw: number; // rect half extents
  hh: number;
  dmg: number;
  type: DamageType;
}

const TEMP_POOL_SIZE = 128;

class TempSpawner {
  readonly bullets: TempBullet[] = Array.from({ length: TEMP_POOL_SIZE }, () => ({
    active: false,
    shape: 'circle' as const,
    x: 0, y: 0, vx: 0, vy: 0, r: 0, hw: 0, hh: 0, dmg: 0,
    type: 'normal' as DamageType,
  }));
  private t = 0;
  private nextLine = 1.0;
  private nextAimed = 2.0;
  private nextKr = 3.5;
  private lineSide = 0;

  constructor(private readonly box: Box) {}

  private spawn(props: Omit<TempBullet, 'active'>): void {
    const b = this.bullets.find((x) => !x.active);
    if (b) Object.assign(b, props, { active: true });
  }

  update(dt: number, soulX: number, soulY: number): void {
    this.t += dt;
    const hw = this.box.halfWidth;
    const hh = this.box.halfHeight;

    // Straight line: a column of bullets with a two-bullet gap, alternating sides.
    if (this.t >= this.nextLine) {
      this.nextLine += 1.4;
      const fromLeft = this.lineSide++ % 2 === 0;
      const count = 9;
      const gap = Math.floor(Math.random() * (count - 2)) + 1;
      const spacing = (hh * 2) / count;
      for (let i = 0; i < count; i++) {
        if (i === gap || i === gap + 1) continue;
        this.spawn({
          shape: 'circle',
          x: fromLeft ? -hw - 10 : hw + 10,
          y: -hh + spacing * (i + 0.5),
          vx: fromLeft ? 110 : -110, vy: 0,
          r: 6, hw: 0, hh: 0, dmg: 8, type: 'normal',
        });
      }
    }

    // Aimed shot: from a random edge point straight at the soul.
    if (this.t >= this.nextAimed) {
      this.nextAimed += 1.1;
      const side = Math.floor(Math.random() * 4);
      const u = Math.random() * 2 - 1;
      const sx = side === 0 ? -hw - 10 : side === 1 ? hw + 10 : u * hw;
      const sy = side === 2 ? -hh - 10 : side === 3 ? hh + 10 : u * hh;
      const len = Math.hypot(soulX - sx, soulY - sy) || 1;
      const speed = 190;
      this.spawn({
        shape: 'circle', x: sx, y: sy,
        vx: ((soulX - sx) / len) * speed, vy: ((soulY - sy) / len) * speed,
        r: 5, hw: 0, hh: 0, dmg: 10, type: 'normal',
      });
    }

    // KR bar: a thin horizontal bar sweeping vertically across part of the box.
    if (this.t >= this.nextKr) {
      this.nextKr += 3.2;
      const down = Math.random() < 0.5;
      this.spawn({
        shape: 'rect', x: 0, y: down ? -hh - 8 : hh + 8,
        vx: 0, vy: down ? 70 : -70,
        r: 0, hw: hw * 0.55, hh: 4, dmg: 20, type: 'kr',
      });
    }

    const margin = 40;
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (Math.abs(b.x) > hw + margin || Math.abs(b.y) > hh + margin) b.active = false;
    }
  }
}
// --------------------------- end TEMPORARY ---------------------------------

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'shift' | 'r';

export class BattleScene extends Phaser.Scene {
  private box!: Box;
  private soul!: Soul;
  private clock!: Clock;
  private spawner!: TempSpawner;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private boxGfx!: Phaser.GameObjects.Graphics;
  private maskGfx!: Phaser.GameObjects.Graphics;
  private bulletGfx!: Phaser.GameObjects.Graphics;
  private soulGfx!: Phaser.GameObjects.Graphics;
  private hudGfx!: Phaser.GameObjects.Graphics;
  private hpLabel!: Phaser.GameObjects.Text;
  private hpValue!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private readonly move: MoveInput = { dx: 0, dy: 0, slow: false };
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  constructor() {
    super('Battle');
  }

  private lastFrame = 0;

  create(): void {
    this.lastFrame = 0;
    const { width, height } = this.scale;
    this.box = new Box(width / 2, height / 2 - 20, BOX_WIDTH, BOX_HEIGHT);
    this.soul = new Soul();
    this.clock = new Clock();
    this.spawner = new TempSpawner(this.box);

    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard!.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, shift: K.SHIFT, r: K.R,
    }) as Record<KeyName, Phaser.Input.Keyboard.Key>;

    this.boxGfx = this.add.graphics();
    this.bulletGfx = this.add.graphics();
    this.soulGfx = this.add.graphics();
    this.hudGfx = this.add.graphics();
    // Bullets are only visible inside the box interior.
    this.maskGfx = this.make.graphics({}, false);
    this.bulletGfx.setMask(this.maskGfx.createGeometryMask());

    const font = { fontFamily: 'monospace', fontSize: '16px', color: toCss(theme.text) };
    this.hpLabel = this.add.text(0, 0, 'HP', font);
    this.hpValue = this.add.text(0, 0, '', font);
    this.statusText = this.add
      .text(width / 2, height - 28, '', { ...font, fontSize: '12px', color: toCss(theme.textDim) })
      .setOrigin(0.5);

    if (import.meta.env.DEV) {
      // Dev-only handle for inspecting state from the browser console.
      (window as unknown as Record<string, unknown>).__battle = {
        soul: this.soul, clock: this.clock, box: this.box, game: this.game,
      };
    }
  }

  update(): void {
    this.readInput();
    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.scene.restart();
      return;
    }
    // Real wall-clock time, not Phaser's `delta`: Phaser smooths and caps delta,
    // which silently slows the simulation when the frame rate drops.
    const now = performance.now();
    const elapsed = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const steps = this.clock.advance(elapsed);
    for (let i = 0; i < steps; i++) this.step(STEP);
    this.draw();
  }

  private readInput(): void {
    const k = this.keys;
    const left = k.left.isDown || k.a.isDown;
    const right = k.right.isDown || k.d.isDown;
    const up = k.up.isDown || k.w.isDown;
    const down = k.down.isDown || k.s.isDown;
    this.move.dx = (right ? 1 : 0) - (left ? 1 : 0);
    this.move.dy = (down ? 1 : 0) - (up ? 1 : 0);
    this.move.slow = k.shift.isDown;
  }

  private step(dt: number): void {
    const soul = this.soul;
    soul.move(this.move, dt, this.box);
    soul.tick(dt);
    if (!soul.alive) return;
    this.spawner.update(dt, soul.pos.x, soul.pos.y);

    const hit = { x: soul.pos.x, y: soul.pos.y, r: soul.hitRadius };
    for (const b of this.spawner.bullets) {
      if (!b.active) continue;
      const touching =
        b.shape === 'circle'
          ? circleVsCircle(hit, { x: b.x, y: b.y, r: b.r })
          : circleVsRect(hit, { x: b.x, y: b.y, hw: b.hw, hh: b.hh });
      if (touching) soul.damage({ amount: b.dmg, type: b.type });
    }
  }

  private draw(): void {
    const { box, soul } = this;
    const hw = box.halfWidth;
    const hh = box.halfHeight;

    // Box corners go local -> world so a rotated box (Phase 5) just works.
    const corners = [
      box.toWorld({ x: -hw, y: -hh }),
      box.toWorld({ x: hw, y: -hh }),
      box.toWorld({ x: hw, y: hh }),
      box.toWorld({ x: -hw, y: hh }),
    ];
    const g = this.boxGfx;
    g.clear();
    g.fillStyle(theme.boxFill, 1);
    g.fillPoints(corners, true);
    g.lineStyle(BOX_BORDER, theme.boxBorder, 1);
    g.strokePoints(corners, true, true);

    this.maskGfx.clear();
    this.maskGfx.fillStyle(0xffffff, 1);
    this.maskGfx.fillPoints(corners, true);

    // Bullets
    const bg = this.bulletGfx;
    bg.clear();
    for (const b of this.spawner.bullets) {
      if (!b.active) continue;
      const w = box.toWorld(b, this.tmp);
      bg.fillStyle(b.type === 'kr' ? theme.bulletKr : theme.bulletNormal, 1);
      if (b.shape === 'circle') bg.fillCircle(w.x, w.y, b.r);
      else bg.fillRect(w.x - b.hw, w.y - b.hh, b.hw * 2, b.hh * 2);
    }

    // Soul: diamond, blinking during i-frames. Hitbox dot visible in slow mode.
    const sg = this.soulGfx;
    sg.clear();
    const sw = box.toWorld(soul.pos, this.tmp);
    const blinkOff = soul.invulnerable && Math.floor(soul.iframes / IFRAME_BLINK_PERIOD) % 2 === 0;
    if (soul.alive && !blinkOff) {
      const s = SOUL_DRAW_SIZE;
      sg.fillStyle(theme.soul, 1);
      sg.fillPoints(
        [
          { x: sw.x, y: sw.y - s },
          { x: sw.x + s, y: sw.y },
          { x: sw.x, y: sw.y + s },
          { x: sw.x - s, y: sw.y },
        ],
        true,
      );
    }
    if (soul.alive && this.move.slow) {
      sg.fillStyle(theme.boxBorder, 1);
      sg.fillCircle(sw.x, sw.y, soul.hitRadius);
    }

    // HP bar: [ hp - kr (yellow) | kr pool (magenta) | missing (dark) ]
    const barW = 160;
    const barH = 14;
    const bx = box.x - barW / 2;
    const by = box.y + hh + 24;
    const hp = Math.max(0, soul.hp);
    const px = barW / soul.maxHp;
    const hg = this.hudGfx;
    hg.clear();
    hg.fillStyle(theme.hpEmpty, 1);
    hg.fillRect(bx, by, barW, barH);
    hg.fillStyle(theme.hpFill, 1);
    hg.fillRect(bx, by, (hp - soul.kr) * px, barH);
    if (soul.kr > 0) {
      hg.fillStyle(theme.kr, 1);
      hg.fillRect(bx + (hp - soul.kr) * px, by, soul.kr * px, barH);
    }

    this.hpLabel.setPosition(bx - 32, by - 1);
    this.hpValue.setPosition(bx + barW + 12, by - 1);
    this.hpValue.setText(`${Math.ceil(hp)} / ${soul.maxHp}${soul.kr > 0 ? ' KR' : ''}`);
    this.hpValue.setColor(toCss(soul.kr > 0 ? theme.kr : theme.text));
    this.statusText.setText(
      soul.alive
        ? 'arrows / WASD move  ·  shift slow  ·  R restart'
        : 'DOWN  ·  press R to restart',
    );
  }
}
