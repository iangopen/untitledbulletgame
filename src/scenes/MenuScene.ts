import Phaser from 'phaser';
import { VIEW, space, theme, type } from '../render/theme';
import { parseRosterParam } from '../director/roster';
import { drawShape, enter, go, hint, label, nudge, pop, setColor } from './ui';

interface Option {
  text: string;
  available: boolean;
  note?: string;
}

const OPTIONS: Option[] = [
  { text: 'Timer', available: true },
  { text: 'Waves', available: false, note: 'soon' },
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
    const { cx } = VIEW;
    const g = this.add.graphics();
    // Mark: the soul (red circle, the one accent) between two hazard shapes.
    drawShape(g, 'triangle', cx - 56, 214, 20, theme.prism);
    drawShape(g, 'circle', cx, 216, 11, theme.soul);
    drawShape(g, 'square', cx + 56, 216, 18, theme.bulletNormal);
    label(this, cx, 300, 'untitled bullet game', { size: type.title, weight: 600 });

    this.items = OPTIONS.map((o, i) => {
      const y = 420 + i * (type.label + space.md);
      const t = label(this, cx, y, o.text, { size: type.label, color: o.available ? theme.text : theme.textMuted });
      if (o.note) label(this, cx + t.width / 2 + space.sm, y + 2, o.note, { size: type.hint, color: theme.textMuted, align: 'left' });
      return t;
    });
    this.marker = this.add.graphics();
    hint(this, '↑ ↓ choose    enter select');

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
    pop(this, this.items[this.index]!, 1.08);
  }

  private refresh(): void {
    this.items.forEach((t, i) => {
      const o = OPTIONS[i]!;
      setColor(t, i === this.index ? (o.available ? theme.text : theme.textDim) : o.available ? theme.textDim : theme.textMuted);
    });
    const t = this.items[this.index]!;
    this.marker.clear();
    drawShape(this.marker, 'circle', t.x - t.width / 2 - space.md, t.y, 6, theme.soul);
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
