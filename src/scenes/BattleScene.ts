import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { theme, toCss } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { registry } from '../characters/registry';
import type { CharacterHandle } from '../characters/Character';

/** Default Prism level when no ?prism= parameter is given. */
const DEFAULT_LEVELS: Record<string, number> = { prism: 1 };

/** Level for each registered character: scene data (restart) > URL ?<id>=n > default. */
function initialLevels(data: { levels?: Record<string, number> }): Record<string, number> {
  const params = new URLSearchParams(window.location.search);
  const out: Record<string, number> = {};
  for (const c of registry) {
    const fromUrl = params.get(c.id);
    const parsed = fromUrl === null ? NaN : Number.parseInt(fromUrl, 10);
    out[c.id] = data.levels?.[c.id] ?? (Number.isFinite(parsed) ? parsed : (DEFAULT_LEVELS[c.id] ?? 0));
  }
  return out;
}

export class BattleScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private status!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  // ---------------------------------------------------------------------
  // TEMPORARY runner (Phase 3): stands in for the Director (Phase 4).
  // Creates every registered character at its level and ticks the active ones.
  // ---------------------------------------------------------------------
  private characters: CharacterHandle[] = [];

  constructor() {
    super('Battle');
  }

  create(data: { levels?: Record<string, number> } = {}): void {
    const { width, height } = this.scale;
    this.world = new World(width / 2, height / 2 - 20);
    this.view = new BattleView(this, this.world);
    this.loop = new FixedLoop(this);

    const levels = initialLevels(data);
    this.characters = registry.map((entry) => {
      const c = entry.create(this.world);
      c.setLevel(levels[entry.id] ?? 0);
      return c;
    });

    const dev = import.meta.env.DEV;
    const mono = { fontFamily: 'monospace', fontSize: '12px', color: toCss(theme.textDim) };
    this.status = this.add.text(width / 2, height - 26, '', mono).setOrigin(0.5);
    this.levelText = this.add.text(12, 10, '', { ...mono, fontSize: '14px' });

    const kb = this.input.keyboard!;
    kb.on('keydown-R', () => this.scene.restart({ levels: this.currentLevels() }));
    if (dev) {
      kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
      kb.on('keydown-BACKTICK', () => this.scene.start('Debug'));
      kb.on('keydown-OPEN_BRACKET', () => this.bumpLevel('prism', -1));
      kb.on('keydown-CLOSED_BRACKET', () => this.bumpLevel('prism', 1));
      (window as unknown as Record<string, unknown>).__battle = {
        world: this.world, view: this.view, loop: this.loop, game: this.game, characters: this.characters,
        setLevel: (id: string, lv: number) => this.characters.find((c) => c.id === id)?.setLevel(lv),
      };
    }
    this.status.setText(
      'arrows / WASD move  ·  shift slow  ·  R restart' + (dev ? '  ·  [ ] prism level  ·  H hitboxes  ·  ` debug' : ''),
    );
    this.events.once('shutdown', () => this.characters.forEach((c) => c.dispose()));
  }

  private currentLevels(): Record<string, number> {
    return Object.fromEntries(this.characters.map((c) => [c.id, c.level]));
  }

  private bumpLevel(id: string, delta: number): void {
    const c = this.characters.find((x) => x.id === id);
    if (c) c.setLevel(c.level + delta);
  }

  update(): void {
    const w = this.world;
    this.loop.frame((input, dt) => {
      if (w.soul.alive) for (const c of this.characters) c.tick(dt);
      w.step(input, dt);
    });
    this.view.draw(this.loop.realDt);
    this.levelText.setText(
      this.characters.map((c) => `${registry.find((e) => e.id === c.id)?.name.toUpperCase()} LV ${c.level}`).join('   '),
    );
    this.levelText.setColor(toCss(theme.prism));
    if (!w.soul.alive) this.status.setText('DOWN  ·  press R to restart');
  }
}
