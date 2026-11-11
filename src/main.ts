// Must stay first: dev-only devicePixelRatio override for testing.
import './dev/dprOverride';
import Phaser from 'phaser';
// Self-hosted fonts (bundled by Vite from npm, no CDN).
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import { MenuScene } from './scenes/MenuScene';
import { RosterScene } from './scenes/RosterScene';
import { BattleScene } from './scenes/BattleScene';
import { ResultsScene } from './scenes/ResultsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { frameLimiter } from './render/frameLimiter';
import { settings } from './settings/store';
import { theme } from './render/theme';
import { initialCanvasSize, installResize, refit } from './render/display';
import { ui } from './ui/UiLayer';
import { perfOverlay } from './ui/PerfOverlay';

async function boot(): Promise<void> {
  // Make sure the webfonts are ready before the first screen renders (DOM UI and dev Phaser text).
  await Promise.all(
    ['400 20px Inter', '600 20px Inter', '400 20px "JetBrains Mono"', '600 20px "JetBrains Mono"'].map((f) =>
      document.fonts.load(f).catch(() => undefined),
    ),
  );

  // HTML UI layer over the canvas (menus, HUD text): crisp at any pixel ratio, mouse-clickable.
  ui.init(document.getElementById('game')!);

  const size = initialCanvasSize();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: size.width,
    height: size.height,
    backgroundColor: theme.background,
    antialias: true,
    // FIT + CENTER_BOTH keeps the 16:9 view centered; the canvas is already device-pixel sized (see display.ts).
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    // Flow: Menu -> Roster -> Battle -> Results (-> Battle retry | Roster). First scene listed starts.
    // Settings is last so it draws over a paused Battle.
    scene: [MenuScene, RosterScene, BattleScene, ResultsScene, SettingsScene],
  });
  installResize(game);
  // F3 performance overlay, in every build.
  perfOverlay.install(game);
  // Frame-rate limit + display refresh measurement (skips whole display ticks; never touches the sim).
  frameLimiter.install(game);
  // Phaser processes its whole keyboard queue on every DOM key event but only empties it once per
  // game step, so two presses inside one drawn frame replay the first (common under a frame cap).
  // Its window listeners are added at boot, before 'ready'; ours run after them and drop the
  // already-processed events. Key states (isDown) were updated synchronously, so nothing is lost.
  game.events.once('ready', () => {
    // `queue` is internal to Phaser's KeyboardManager (not in its typings).
    const kb = game.input.keyboard as unknown as { queue: KeyboardEvent[] } | null;
    if (!kb) return;
    const drop = () => {
      kb.queue.length = 0;
    };
    window.addEventListener('keydown', drop);
    window.addEventListener('keyup', drop);
  });
  // Settings apply live: quality refits the canvas now; Show FPS pins the overlay.
  perfOverlay.setVisible(settings.current.showFps);
  settings.onChange((s, changed) => {
    if (changed.includes('quality')) refit(game);
    if (changed.includes('showFps')) perfOverlay.setVisible(s.showFps);
  });
  ui.attachCanvas(game.canvas);

  // Dev-only: DEV is a build-time constant, so this branch and DebugScene are dropped from production.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__game = game;
    void import('./scenes/DebugScene').then(({ DebugScene }) => game.scene.add('Debug', DebugScene));
  }
}

void boot();
