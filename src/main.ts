import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { RosterScene } from './scenes/RosterScene';
import { BattleScene } from './scenes/BattleScene';
import { ResultsScene } from './scenes/ResultsScene';
import { theme } from './render/theme';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 640,
  height: 480,
  backgroundColor: theme.background,
  antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Flow: Menu -> Roster -> Battle -> Results (-> Battle retry | Roster). First scene listed starts.
  scene: [MenuScene, RosterScene, BattleScene, ResultsScene],
});

// Dev-only: DEV is a build-time constant, so this branch and DebugScene are dropped from production.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = game;
  void import('./scenes/DebugScene').then(({ DebugScene }) => game.scene.add('Debug', DebugScene));
}
