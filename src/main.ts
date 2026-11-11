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

async function boot(): Promise<void> {
  // Phaser rasterises text once; make sure the webfonts are ready first.
  await Promise.all(
    ['400 20px Inter', '600 20px Inter', '400 20px "JetBrains Mono"', '600 20px "JetBrains Mono"'].map((f) =>
      document.fonts.load(f).catch(() => undefined),
    ),
  );

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

  // Dev-only: DEV is a build-time constant, so this branch and DebugScene are dropped from production.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__game = game;
    void import('./scenes/DebugScene').then(({ DebugScene }) => game.scene.add('Debug', DebugScene));
  }
}

void boot();
