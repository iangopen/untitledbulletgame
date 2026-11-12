import Phaser from 'phaser';
import { VIEW, theme } from '../render/theme';
import { parseRosterParam, rememberRoster } from '../director/roster';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';

interface Option {
  text: string;
  /** Scene to open. */
  scene?: string;
  available: boolean;
  note?: string;
}

const OPTIONS: Option[] = [
  { text: 'Custom', scene: 'Roster', available: true },
  { text: 'Wave mode', available: false, note: 'soon' },
  { text: 'Player', scene: 'Player', available: true },
  { text: 'Debug', scene: 'Debug', available: true },
  { text: 'Settings', scene: 'Settings', available: true },
];

/** The ?roster= dev shortcut applies once per page load, not every time the menu opens. */
let shortcutConsumed = false;

/** Title and mode select. State (selected index) lives here; the DOM only renders it and forwards input. */
export class MenuScene extends Phaser.Scene {
  private index = 0;
  private rows: HTMLElement[] = [];

  constructor() {
    super('Menu');
  }

  create(): void {
    if (!shortcutConsumed) {
      shortcutConsumed = true;
      const roster = parseRosterParam(new URLSearchParams(window.location.search).get('roster'));
      if (roster) {
        rememberRoster(roster); // the Custom grid opens with these levels afterwards
        this.scene.start('Battle', { roster });
        return;
      }
    }

    enter(this);
    const { cx } = VIEW;
    const screen = h('div');
    // Mark: the soul (red circle, the one accent) between two hazard shapes.
    screen.append(
      at(shape('triangle', theme.prism, 20), cx - 56, 164),
      at(shape('circle', theme.soul, 11), cx, 166),
      at(shape('square', theme.bullet.white, 18), cx + 56, 166),
      at(h('div', 't-title', 'untitled bullet game'), cx, 250),
    );

    this.rows = OPTIONS.map((o, i) => {
      const row = at(h('div', `opt t-label ${o.available ? 'click' : 'off no'}`), cx, 360 + i * 50);
      row.append(h('span', 'dot'), h('span', '', o.text));
      if (o.note) row.append(h('span', 'note', o.note));
      // Hover selects (same state as the keyboard); locked options ignore the mouse.
      if (o.available) {
        row.addEventListener('mouseenter', () => this.setIndex(i));
        row.addEventListener('click', () => {
          this.setIndex(i);
          this.choose();
        });
      }
      screen.append(row);
      return row;
    });
    screen.append(at(h('div', 't-hint', '↑ ↓ choose    enter select'), cx, VIEW.height - 40));
    mountScreen(this, screen);

    this.index = 0;
    this.render();
    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-ENTER', () => this.choose());
    kb.on('keydown-SPACE', () => this.choose());
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.render();
  }

  private move(d: number): void {
    this.setIndex((this.index + d + OPTIONS.length) % OPTIONS.length);
    replay(this.rows[this.index]!, 'pop');
  }

  private render(): void {
    this.rows.forEach((r, i) => r.classList.toggle('sel', i === this.index));
  }

  private choose(): void {
    const o = OPTIONS[this.index]!;
    if (!o.available) {
      replay(this.rows[this.index]!, 'nudge');
      return;
    }
    go(this, o.scene!, o.scene === 'Settings' ? { from: 'Menu' } : undefined);
  }
}
