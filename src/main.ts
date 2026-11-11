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
import { theme } from './render/theme';
import { initialCanvasSize, installResize } from './render/display';
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
    scene: [MenuScene, RosterScene, BattleScene, ResultsScene],
  });
  installResize(game);
  // F3 performance overlay, in every build.
  perfOverlay.install(game);
  ui.attachCanvas(game.canvas);

  // Dev-only: DEV is a build-time constant, so this branch and DebugScene are dropped from production.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__game = game;
    void import('./scenes/DebugScene').then(({ DebugScene }) => game.scene.add('Debug', DebugScene));
  }
}

void boot();
