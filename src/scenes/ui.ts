import Phaser from 'phaser';
import { fonts, theme, toCss } from '../render/theme';
import { SCENE_FADE_MS } from '../tuning';

export type ShapeKind = 'triangle' | 'circle' | 'square' | 'diamond';

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: { size?: number; color?: number; mono?: boolean; bold?: boolean; align?: 'left' | 'center' | 'right' } = {},
): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: opts.mono ? fonts.mono : fonts.sans,
    fontSize: `${opts.size ?? 14}px`,
    fontStyle: opts.bold ? 'bold' : 'normal',
    color: toCss(opts.color ?? theme.text),
    align: opts.align ?? 'center',
  });
  const ox = opts.align === 'left' ? 0 : opts.align === 'right' ? 1 : 0.5;
  return t.setOrigin(ox, 0.5).setResolution(2);
}

/** Flat solid shape (or outline when `outline` is set). */
export function drawShape(g: Phaser.GameObjects.Graphics, kind: ShapeKind, x: number, y: number, r: number, color: number, outline = false): void {
  const pts: { x: number; y: number }[] = [];
  if (kind === 'circle') {
    if (outline) {
      g.lineStyle(2, color, 1);
      g.strokeCircle(x, y, r);
    } else {
      g.fillStyle(color, 1);
      g.fillCircle(x, y, r);
    }
    return;
  }
  const n = kind === 'triangle' ? 3 : 4;
  const start = kind === 'triangle' ? -Math.PI / 2 : kind === 'square' ? -Math.PI / 4 : -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  if (outline) {
    g.lineStyle(2, color, 1);
    g.strokePoints(pts, true, true);
  } else {
    g.fillStyle(color, 1);
    g.fillPoints(pts, true);
  }
}

/** Quick fade-in on scene start. */
export function enter(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor(theme.background);
  scene.cameras.main.fadeIn(SCENE_FADE_MS, 8, 8, 13);
}

/** Short fade-out, then switch scene. Ignores repeat calls while leaving. */
export function go(scene: Phaser.Scene, key: string, data?: object): void {
  const s = scene as Phaser.Scene & { __leaving?: boolean };
  if (s.__leaving) return;
  s.__leaving = true;
  const cam = scene.cameras.main;
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    s.__leaving = false;
    scene.scene.start(key, data);
  });
  cam.fadeOut(SCENE_FADE_MS, 8, 8, 13);
}

/** Tiny scale pop for feedback on a changed value. */
export function pop(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, amount = 1.25): void {
  scene.tweens.killTweensOf(target);
  target.setScale(amount);
  scene.tweens.add({ targets: target, scale: 1, duration: 120, ease: 'Quad.easeOut' });
}

/** Horizontal shake for "not allowed" feedback. */
export function nudge(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject): void {
  const x0 = (target as unknown as { __x0?: number }).__x0 ?? target.x;
  (target as unknown as { __x0?: number }).__x0 = x0;
  scene.tweens.killTweensOf(target);
  // Killing tweens can interrupt a pop mid-scale; restore rest state.
  (target as unknown as { setScale?: (s: number) => void }).setScale?.(1);
  target.x = x0;
  scene.tweens.add({ targets: target, x: x0 + 5, duration: 40, yoyo: true, repeat: 2, onComplete: () => (target.x = x0) });
}
