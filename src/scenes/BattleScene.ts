import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { theme, toCss } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { Demo } from './demo';

export class BattleScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private demo!: Demo;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  create(): void {
    const { width, height } = this.scale;
    this.world = new World(width / 2, height / 2 - 20);
    this.view = new BattleView(this, this.world);
    this.loop = new FixedLoop(this);
    this.demo = new Demo();

    const dev = import.meta.env.DEV;
    this.status = this.add
      .text(width / 2, height - 26, '', { fontFamily: 'monospace', fontSize: '12px', color: toCss(theme.textDim) })
      .setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-R', () => this.scene.restart());
    if (dev) {
      kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
      kb.on('keydown-BACKTICK', () => this.scene.start('Debug'));
      (window as unknown as Record<string, unknown>).__battle = { world: this.world, view: this.view, loop: this.loop, game: this.game };
    }
    this.status.setText(
      'arrows / WASD move  ·  shift slow  ·  R restart' + (dev ? '  ·  H hitboxes  ·  ` debug' : ''),
    );
  }

  update(): void {
    const w = this.world;
    this.loop.frame((input, dt) => {
      if (w.soul.alive) this.demo.step(w, dt);
      w.step(input, dt);
    });
    this.view.draw(this.loop.realDt);
    if (!w.soul.alive) this.status.setText('DOWN  ·  press R to restart');
  }
}
