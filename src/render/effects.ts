import type Phaser from 'phaser';
import { settings } from '../settings/store';

/**
 * The single gate for screen effects. Anything that shakes or flashes the screen goes through
 * these, so the Settings toggles (screen shake, hit flash) cover every current and future effect.
 */
export function shakeScreen(cam: Phaser.Cameras.Scene2D.Camera, ms: number, intensity: number): void {
  if (!settings.current.shake) return;
  cam.shake(ms, intensity);
}

export function flashScreen(cam: Phaser.Cameras.Scene2D.Camera, ms: number, r: number, g: number, b: number): void {
  if (!settings.current.flash) return;
  cam.flash(ms, r, g, b, true);
}

/**
 * Gameplay cue: the shine when a pre-active (gold) projectile becomes active. It goes through this
 * gate file but is deliberately NOT gated by the hit-flash setting: it tells the player a sword is
 * now dangerous, so it is part of the game, not a screen effect. Local to the bullet, never full screen.
 * `t` = 0..1 through the shine; `r` = the bullet's extent.
 */
export function drawShine(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, t: number, color: number): void {
  const k = 1 - t;
  g.fillStyle(color, 0.35 * k);
  g.fillCircle(x, y, r * (0.7 + 0.5 * t));
  g.lineStyle(2, color, 0.9 * k);
  g.strokeCircle(x, y, r * (0.8 + 0.7 * t));
}
