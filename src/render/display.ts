import Phaser from 'phaser';
import { VIEW } from './theme';

/**
 * Crisp rendering at any window size and DPI.
 *
 * Scenes lay out in a fixed 1280x720 virtual view (VIEW). The canvas itself is sized to the
 * real device pixels the view will occupy (fit-to-window x devicePixelRatio), and each scene's
 * main camera zooms the virtual view up to that size. Nothing is upscaled by CSS, so edges and
 * text stay sharp. Text is rasterised at the same scale.
 */
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

let current = computeScale();

/** Size of the element the game is fitted into (falls back to the window). */
function hostSize(): { w: number; h: number } {
  const el = document.getElementById('game');
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : { w: window.innerWidth, h: window.innerHeight };
}

export function computeScale(): number {
  const { w, h } = hostSize();
  const fit = Math.min(w / VIEW.width, h / VIEW.height);
  const dpr = window.devicePixelRatio || 1;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit * dpr));
}

/** Device pixels per virtual pixel right now. */
export function renderScale(): number {
  return current;
}

/** Point this scene's main camera at the virtual view. Call in every scene's create(). */
export function applyView(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setSize(scene.scale.width, scene.scale.height);
  cam.setZoom(current);
  cam.centerOn(VIEW.cx, VIEW.cy);
}

function forEachText(list: Phaser.GameObjects.GameObject[], fn: (t: Phaser.GameObjects.Text) => void): void {
  for (const o of list) {
    if (o instanceof Phaser.GameObjects.Text) fn(o);
    else if (o instanceof Phaser.GameObjects.Container) forEachText(o.list, fn);
  }
}

/** Resize the canvas with the window and re-rasterise text so it stays crisp. */
export function installResize(game: Phaser.Game): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const apply = () => {
    const next = computeScale();
    if (Math.abs(next - current) > 1e-3) {
      current = next;
      game.scale.resize(Math.round(VIEW.width * current), Math.round(VIEW.height * current));
      for (const scene of game.scene.getScenes(true)) {
        applyView(scene);
        forEachText(scene.children.list, (t) => t.setResolution(current));
      }
    }
    // Re-fit and re-center the canvas to its parent (Phaser only does this on window resize).
    game.scale.refresh();
  };
  // Debounced with a timer, not rAF, so it still runs when frames are throttled.
  const onResize = () => {
    clearTimeout(pending);
    pending = setTimeout(apply, 60);
  };
  window.addEventListener('resize', onResize);
  // Also catches container size changes that don't resize the window.
  const el = document.getElementById('game');
  if (el && 'ResizeObserver' in window) new ResizeObserver(onResize).observe(el);
}

/** Initial canvas size in device pixels. */
export function initialCanvasSize(): { width: number; height: number } {
  return { width: Math.round(VIEW.width * current), height: Math.round(VIEW.height * current) };
}
