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
