import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { theme } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { Director } from '../director/Director';
import { TimerMode } from '../director/modes/TimerMode';
import { DEFAULT_ROSTER, normalizeRoster, type Roster } from '../director/roster';
import { registry } from '../characters/registry';
import { enter, go, label, pop } from './ui';

export interface BattleData {
  roster?: Roster;
}

const PAUSE_OPTIONS = ['RESUME', 'RESTART', 'QUIT TO ROSTER'] as const;
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
  private ending = false;
  private lastShownSecond = -1;

  constructor() {
    super('Battle');
  }

  create(data: BattleData = {}): void {
    enter(this);
    // Fresh state every time: roster is copied plain data, everything else is new.
    this.roster = normalizeRoster(data.roster ?? DEFAULT_ROSTER);
    const { width, height } = this.scale;
    this.world = new World(width / 2, height / 2 + 6);
    this.view = new BattleView(this, this.world);
    this.loop = new FixedLoop(this);
    this.director = new Director(this.world, this.roster, new TimerMode(devDuration()));
    this.paused = false;
    this.ending = false;
    this.lastShownSecond = -1;

    // HUD: countdown top center, roster summary top left, hint bottom.
    this.timerText = label(this, width / 2, 40, '', { size: 30, bold: true, mono: true });
    label(this, width / 2, 66, 'SURVIVE', { size: 10, color: theme.textDim });
    const summary = registry
      .filter((e) => (this.roster[e.id] ?? 0) > 0)
      .map((e) => `${e.name.toUpperCase()} ${this.roster[e.id]}`)
      .join('   ');
    label(this, 16, 22, summary || 'NO CHARACTERS', { size: 12, mono: true, align: 'left', color: summary ? theme.prism : theme.textDim });
    label(this, width / 2, height - 14, 'arrows / WASD move   shift slow   ESC pause', { size: 11, mono: true, color: theme.textDim });

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
    const { width, height } = this.scale;
    const bg = this.add.graphics();
    bg.fillStyle(theme.background, 0.82);
    bg.fillRect(0, 0, width, height);
    const title = label(this, width / 2, 150, 'PAUSED', { size: 28, bold: true });
    this.pauseItems = PAUSE_OPTIONS.map((t, i) => label(this, width / 2, 208 + i * 38, t, { size: 18, bold: true }));
    const hint = label(this, width / 2, 336, '↑ ↓ choose   ENTER select   ESC resume', { size: 11, mono: true, color: theme.textDim });
    this.pauseLayer = this.add.container(0, 0, [bg, title, ...this.pauseItems, hint]).setDepth(10).setVisible(false);
  }

  private pause(): void {
    if (this.ending) return;
    this.paused = true;
    this.pauseIndex = 0;
    this.refreshPause();
    this.pauseLayer.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.pauseLayer, alpha: 1, duration: 90 });
  }

  private resume(): void {
    this.paused = false;
    this.pauseLayer.setVisible(false);
    this.loop.resync(); // don't let the clock "catch up" on time spent paused
  }

  private movePause(d: number): void {
    this.pauseIndex = (this.pauseIndex + d + PAUSE_OPTIONS.length) % PAUSE_OPTIONS.length;
    this.refreshPause();
    pop(this, this.pauseItems[this.pauseIndex]!, 1.1);
  }

  private refreshPause(): void {
    this.pauseItems.forEach((t, i) => t.setColor(Phaser.Display.Color.IntegerToColor(i === this.pauseIndex ? theme.text : theme.textDim).rgba));
  }

  private choosePause(): void {
    const choice = PAUSE_OPTIONS[this.pauseIndex];
    if (choice === 'RESUME') this.resume();
    else if (choice === 'RESTART') go(this, 'Battle', { roster: { ...this.roster } });
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
