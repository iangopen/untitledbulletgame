import Phaser from 'phaser';
import { VIEW, fonts, line, theme, toCss, type } from '../render/theme';
import { applyView, renderScale } from '../render/display';
import { SCENE_FADE_MS } from '../tuning';

export type ShapeKind = 'triangle' | 'circle' | 'square' | 'diamond';

export interface LabelOpts {
  size?: number;
  color?: number;
  mono?: boolean;
  weight?: 400 | 600;
  align?: 'left' | 'center' | 'right';
  /** Letter spacing in px (small positive values for tiny caps-free labels). */
  spacing?: number;
}

/** Text in the UI typeface (or mono for numbers), rasterised at the current render scale. */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts: LabelOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, {
    fontFamily: opts.mono ? fonts.mono : fonts.sans,
    fontSize: `${opts.size ?? type.body}px`,
    fontStyle: opts.weight === 600 ? '600' : 'normal',
    color: toCss(opts.color ?? theme.text),
    align: opts.align ?? 'center',
  });
  if (opts.spacing) t.setLetterSpacing(opts.spacing);
  const ox = opts.align === 'left' ? 0 : opts.align === 'right' ? 1 : 0.5;
  return t.setOrigin(ox, 0.5).setResolution(renderScale());
}

export function setColor(t: Phaser.GameObjects.Text, color: number): void {
  t.setColor(toCss(color));
}

/** Flat solid shape, or a thin outline when `outline` is set. */
export function drawShape(g: Phaser.GameObjects.Graphics, kind: ShapeKind, x: number, y: number, r: number, color: number, outline = false, alpha = 1): void {
  if (kind === 'circle') {
    if (outline) {
      g.lineStyle(line.thin, color, alpha);
      g.strokeCircle(x, y, r);
    } else {
      g.fillStyle(color, alpha);
      g.fillCircle(x, y, r);
    }
    return;
  }
  const n = kind === 'triangle' ? 3 : 4;
  const start = kind === 'square' ? -Math.PI / 4 : -Math.PI / 2;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  if (outline) {
    g.lineStyle(line.thin, color, alpha);
    g.strokePoints(pts, true, true);
  } else {
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
  }
}

/** Every scene starts here: zoom the camera to the virtual view, then a quick fade in. */
export function enter(scene: Phaser.Scene): void {
  applyView(scene);
  scene.cameras.main.setBackgroundColor(theme.background);
  const [r, g, b] = [8, 8, 13];
  scene.cameras.main.fadeIn(SCENE_FADE_MS, r, g, b);
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

type Transformable = Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;

/** Tiny scale pop for feedback on a changed value. */
export function pop(scene: Phaser.Scene, target: Transformable, amount = 1.15): void {
  scene.tweens.killTweensOf(target);
  target.setScale(amount);
  scene.tweens.add({ targets: target, scale: 1, duration: 120, ease: 'Quad.easeOut' });
}

/** Horizontal shake for "not allowed" feedback. */
export function nudge(scene: Phaser.Scene, target: Transformable): void {
  const holder = target as unknown as { __x0?: number };
  const x0 = holder.__x0 ?? target.x;
  holder.__x0 = x0;
  scene.tweens.killTweensOf(target);
  // Killing tweens can interrupt a pop mid-scale; restore rest state.
  target.setScale(1);
  target.x = x0;
  scene.tweens.add({ targets: target, x: x0 + 6, duration: 40, yoyo: true, repeat: 2, onComplete: () => (target.x = x0) });
}

/** One quiet controls line at the bottom of the screen. */
export function hint(scene: Phaser.Scene, text: string): Phaser.GameObjects.Text {
  return label(scene, VIEW.cx, VIEW.height - 40, text, { size: type.hint, color: theme.textMuted, spacing: 0.5 });
}
