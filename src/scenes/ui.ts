import Phaser from 'phaser';
import { rgb, theme } from '../render/theme';
import { applyView } from '../render/display';
import { SCENE_FADE_MS } from '../tuning';
import { ui } from '../ui/UiLayer';

const [BR, BG, BB] = rgb(theme.background);

/** Every scene starts here: zoom the camera to the virtual view, then a quick fade in. */
export function enter(scene: Phaser.Scene): void {
  applyView(scene);
  scene.cameras.main.setBackgroundColor(theme.background);
  scene.cameras.main.fadeIn(SCENE_FADE_MS, BR, BG, BB);
}

/** Short fade-out of canvas and HTML layer together, then switch scene. Ignores repeats while leaving. */
export function go(scene: Phaser.Scene, key: string, data?: object): void {
  const s = scene as Phaser.Scene & { __leaving?: boolean };
  if (s.__leaving) return;
  s.__leaving = true;
  ui.fadeOut();
  const cam = scene.cameras.main;
  cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    s.__leaving = false;
    scene.scene.start(key, data);
  });
  cam.fadeOut(SCENE_FADE_MS, BR, BG, BB);
}

/** Mount a DOM screen for this scene and remove it when the scene shuts down. */
export function mountScreen(scene: Phaser.Scene, screen: HTMLElement): void {
  ui.show(screen);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => ui.clear(screen));
}
