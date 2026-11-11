import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { VIEW, space, theme, type } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { Director } from '../director/Director';
import { TimerMode } from '../director/modes/TimerMode';
import { DEFAULT_ROSTER, normalizeRoster, type Roster } from '../director/roster';
import { registry } from '../characters/registry';
import { drawShape, enter, go, hint, label, pop, setColor } from './ui';
import { px } from '../tuning';

export interface BattleData {
  roster?: Roster;
}

const PAUSE_OPTIONS = ['Resume', 'Restart', 'Quit to roster'] as const;
/** Real ms between the outcome and the results screen, so the final hit reads. */
const END_DELAY_MS = 700;

/** Dev only: ?duration=<seconds> shortens timer mode for testing. Ignored in production builds. */
function devDuration(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  const v = Number.parseFloat(new URLSearchParams(window.location.search).get('duration') ?? '');
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Draws the battle and reads input. The Director owns time, characters and the outcome. */
export class BattleScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private director!: Director;
  private roster!: Roster;
  private timerText!: Phaser.GameObjects.Text;
  private paused = false;
  private pauseLayer!: Phaser.GameObjects.Container;
  private pauseItems: Phaser.GameObjects.Text[] = [];
  private pauseIndex = 0;
  private pauseMarker!: Phaser.GameObjects.Graphics;
  private hintText!: Phaser.GameObjects.Text;
  private ending = false;
  private lastShownSecond = -1;

  constructor() {
    super('Battle');
  }

  create(data: BattleData = {}): void {
    enter(this);
    // Fresh state every time: roster is copied plain data, everything else is new.
    this.roster = normalizeRoster(data.roster ?? DEFAULT_ROSTER);
    this.world = new World(VIEW.cx, VIEW.cy + px(6));
    this.view = new BattleView(this, this.world);
    this.loop = new FixedLoop(this);
    this.director = new Director(this.world, this.roster, new TimerMode(devDuration()));
    this.paused = false;
    this.ending = false;
    this.lastShownSecond = -1;

    // HUD: countdown top center (the one bright element), roster summary top left, one quiet hint.
    this.timerText = label(this, VIEW.cx, 92, '', { size: type.number, mono: true });
    const summary = registry
      .filter((e) => (this.roster[e.id] ?? 0) > 0)
      .map((e) => `${e.name} ${this.roster[e.id]}`)
      .join('    ');
    label(this, space.lg, space.lg, summary || 'no opponents', { size: type.small, align: 'left', color: theme.textDim });
    this.hintText = hint(this, 'arrows move    shift slow    esc pause');

    this.buildPause();
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => (this.paused ? this.resume() : this.pause()));
    kb.on('keydown-UP', () => this.paused && this.movePause(-1));
    kb.on('keydown-DOWN', () => this.paused && this.movePause(1));
    kb.on('keydown-ENTER', () => this.paused && this.choosePause());
    kb.on('keydown-SPACE', () => this.paused && this.choosePause());
    if (import.meta.env.DEV) {
      kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
      kb.on('keydown-BACKTICK', () => this.scene.start('Debug'));
      (window as unknown as Record<string, unknown>).__battle = {
        world: this.world, view: this.view, loop: this.loop, director: this.director, scene: this,
      };
    }
    this.events.once('shutdown', () => this.director.dispose());
    this.updateTimer();
  }

  private buildPause(): void {
    const bg = this.add.graphics();
    bg.fillStyle(theme.background, 0.88);
    // Oversized so camera shake never reveals an edge.
    bg.fillRect(-VIEW.width, -VIEW.height, VIEW.width * 3, VIEW.height * 3);
    const title = label(this, VIEW.cx, 250, 'Paused', { size: type.title, weight: 600 });
    this.pauseItems = PAUSE_OPTIONS.map((t, i) => label(this, VIEW.cx, 360 + i * (type.label + space.md), t, { size: type.label }));
    this.pauseMarker = this.add.graphics();
    const quiet = label(this, VIEW.cx, VIEW.height - 40, '↑ ↓ choose    enter select    esc resume', { size: type.hint, color: theme.textMuted });
    this.pauseLayer = this.add.container(0, 0, [bg, title, ...this.pauseItems, this.pauseMarker, quiet]).setDepth(10).setVisible(false);
  }

  private pause(): void {
    if (this.ending) return;
    this.paused = true;
    this.pauseIndex = 0;
    this.refreshPause();
    this.pauseLayer.setVisible(true).setAlpha(0);
    this.hintText.setVisible(false);
    this.tweens.add({ targets: this.pauseLayer, alpha: 1, duration: 90 });
  }

  private resume(): void {
    this.paused = false;
    this.pauseLayer.setVisible(false);
    this.hintText.setVisible(true);
    this.loop.resync(); // don't let the clock "catch up" on time spent paused
  }

  private movePause(d: number): void {
    this.pauseIndex = (this.pauseIndex + d + PAUSE_OPTIONS.length) % PAUSE_OPTIONS.length;
    this.refreshPause();
    pop(this, this.pauseItems[this.pauseIndex]!, 1.1);
  }

  private refreshPause(): void {
    this.pauseItems.forEach((t, i) => setColor(t, i === this.pauseIndex ? theme.text : theme.textDim));
    const t = this.pauseItems[this.pauseIndex]!;
    this.pauseMarker.clear();
    drawShape(this.pauseMarker, 'circle', t.x - t.width / 2 - space.md, t.y, 6, theme.soul);
  }

  private choosePause(): void {
    const choice = PAUSE_OPTIONS[this.pauseIndex];
    if (choice === 'Resume') this.resume();
    else if (choice === 'Restart') go(this, 'Battle', { roster: { ...this.roster } });
    else go(this, 'Roster', { roster: { ...this.roster } });
  }

  private updateTimer(): void {
    const text = this.director.mode.hud(this.director.state);
    this.timerText.setText(text);
    const sec = Math.ceil((this.director.mode as TimerMode).remaining(this.director.time));
    if (sec !== this.lastShownSecond) {
      if (this.lastShownSecond !== -1 && sec <= 10) pop(this, this.timerText, 1.18);
      this.lastShownSecond = sec;
    }
  }

  update(): void {
    if (!this.paused) this.loop.frame((input, dt) => this.director.step(input, dt));
    this.view.draw(this.paused ? 0 : this.loop.realDt);
    this.updateTimer();

    const outcome = this.director.outcome;
    if (outcome && !this.ending) {
      this.ending = true;
      this.time.delayedCall(END_DELAY_MS, () => go(this, 'Results', { outcome: { ...outcome, roster: { ...outcome.roster } } }));
    }
  }
}
