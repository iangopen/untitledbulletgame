import Phaser from 'phaser';
import { theme } from '../render/theme';
import { parseRosterParam } from '../director/roster';
import { drawShape, enter, go, label, nudge, pop } from './ui';

interface Option {
  text: string;
  available: boolean;
  note?: string;
}

const OPTIONS: Option[] = [
  { text: 'TIMER MODE', available: true },
  { text: 'WAVE MODE', available: false, note: 'COMING SOON' },
];

/** The ?roster= dev shortcut applies once per page load, not every time the menu opens. */
let shortcutConsumed = false;

export class MenuScene extends Phaser.Scene {
  private index = 0;
  private items: Phaser.GameObjects.Text[] = [];
  private marker!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Menu');
  }

  create(): void {
    if (!shortcutConsumed) {
      shortcutConsumed = true;
      const roster = parseRosterParam(new URLSearchParams(window.location.search).get('roster'));
      if (roster) {
        this.scene.start('Battle', { roster });
        return;
      }
    }

    enter(this);
    const { width } = this.scale;
    const g = this.add.graphics();
    // Mark: the soul (red circle) between two hazard shapes.
    drawShape(g, 'triangle', width / 2 - 46, 120, 16, theme.prism);
    drawShape(g, 'circle', width / 2, 122, 9, theme.soul);
    drawShape(g, 'square', width / 2 + 46, 122, 15, theme.bulletNormal);
    label(this, width / 2, 182, 'UNTITLED BULLET GAME', { size: 30, bold: true });
    label(this, width / 2, 214, 'dodge everything', { size: 13, color: theme.textDim });

    this.items = OPTIONS.map((o, i) => {
      const t = label(this, width / 2, 290 + i * 46, o.text, { size: 20, bold: true, color: o.available ? theme.text : theme.locked });
      if (o.note) label(this, width / 2, 290 + i * 46 + 18, o.note, { size: 10, color: theme.textDim });
      return t;
    });
    this.marker = this.add.graphics();
    label(this, width / 2, 440, '↑ ↓ choose   ENTER select', { size: 12, color: theme.textDim, mono: true });

    this.index = 0;
    this.refresh();
    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-ENTER', () => this.choose());
    kb.on('keydown-SPACE', () => this.choose());
  }

  private move(d: number): void {
    this.index = (this.index + d + OPTIONS.length) % OPTIONS.length;
    this.refresh();
    pop(this, this.items[this.index]!, 1.12);
  }

  private refresh(): void {
    const t = this.items[this.index]!;
    this.marker.clear();
    drawShape(this.marker, 'circle', t.x - t.width / 2 - 20, t.y, 6, theme.soul);
  }

  private choose(): void {
    const o = OPTIONS[this.index]!;
    if (!o.available) {
      nudge(this, this.items[this.index]!);
      return;
    }
    go(this, 'Roster');
  }
}
