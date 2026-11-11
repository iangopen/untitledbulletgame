import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { theme } from './render/theme';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 640,
  height: 480,
  backgroundColor: theme.background,
  antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BattleScene],
});
