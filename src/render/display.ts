import Phaser from 'phaser';
import { VIEW } from './theme';
import { qualityCap } from '../settings/settings';
import { settings } from '../settings/store';

/**
 * Crisp rendering at any window size and DPI.
 *
 * Pixel-ratio rule: the canvas backing store is always (displayed CSS size) x devicePixelRatio.
 * Scenes lay out in a fixed 1280x720 virtual view (VIEW); the canvas is sized to the device pixels
 * the view occupies (fit-to-host x devicePixelRatio) and each scene's main camera zooms the view up
 * to that size, so shapes are drawn at physical resolution and nothing is upscaled by CSS.
 * Re-fits on window resize, host resize and devicePixelRatio changes.
 * Render quality (Settings) caps the ratio used: Full = devicePixelRatio, Balanced = at most 1.5x
 * CSS size, Performance = 1x CSS size (the browser upscales the canvas; the HTML UI stays native).
 * UI text is not drawn here at all: it lives in the HTML layer (src/ui), which the browser
 * rasterises natively.
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
  const dpr = Math.min(window.devicePixelRatio || 1, qualityCap(settings.current.quality));
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

/**
 * Re-size the canvas backing store to the current scale and re-point every running or paused
 * scene's camera (a paused Battle sits under Settings). Called on resize and on quality changes.
 */
export function refit(game: Phaser.Game): void {
  const next = computeScale();
  if (Math.abs(next - current) > 1e-3) {
    current = next;
    game.scale.resize(Math.round(VIEW.width * current), Math.round(VIEW.height * current));
    for (const scene of game.scene.getScenes(false)) {
      if (!scene.sys.isActive() && !scene.sys.isPaused()) continue;
      applyView(scene);
      forEachText(scene.children.list, (t) => t.setResolution(current));
    }
  }
  // Re-fit and re-center the canvas to its parent (Phaser only does this on window resize).
  game.scale.refresh();
  // Tell overlays (the HTML UI layer) the canvas may have moved.
  window.dispatchEvent(new Event('game-refit'));
}

/** Resize the canvas with the window and re-rasterise text so it stays crisp. */
export function installResize(game: Phaser.Game): void {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const apply = () => refit(game);
  // Debounced with a timer, not rAF, so it still runs when frames are throttled.
  const onResize = () => {
    clearTimeout(pending);
    pending = setTimeout(apply, 60);
  };
  window.addEventListener('resize', onResize);
  // Pixel-ratio changes (browser zoom, Windows scaling, moving to another monitor) re-fit too.
  const watchRatio = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => {
      onResize();
      watchRatio();
    }, { once: true });
  };
  watchRatio();
  // Also catches container size changes that don't resize the window.
  const el = document.getElementById('game');
  if (el && 'ResizeObserver' in window) new ResizeObserver(onResize).observe(el);
}

/** Initial canvas size in device pixels. */
export function initialCanvasSize(): { width: number; height: number } {
  return { width: Math.round(VIEW.width * current), height: Math.round(VIEW.height * current) };
}
