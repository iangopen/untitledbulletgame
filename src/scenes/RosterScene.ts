import Phaser from 'phaser';
import { theme } from '../render/theme';
import { registry, ROSTER_SLOTS, type CharacterEntry } from '../characters/registry';
import { DEFAULT_ROSTER, clampLevel, normalizeRoster, totalLevel, type Roster } from '../director/roster';
import { drawShape, enter, go, label, nudge, pop } from './ui';

interface Slot {
  entry: CharacterEntry | null; // null = locked placeholder
  card: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  level: Phaser.GameObjects.Text;
}

const CARD_W = 104;
const CARD_H = 196;
const GAP = 12;

/** UCN-style roster: five slots, set each character's level 0-20, Enter to fight. */
export class RosterScene extends Phaser.Scene {
  private levels: Record<string, number> = {};
  private slots: Slot[] = [];
  private index = 0;
  private total!: Phaser.GameObjects.Text;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = { ...normalizeRoster(data.roster ?? DEFAULT_ROSTER) };
    const { width } = this.scale;
    label(this, width / 2, 50, 'ROSTER', { size: 26, bold: true });
    label(this, width / 2, 78, 'TIMER MODE', { size: 12, color: theme.textDim });

    const rowW = ROSTER_SLOTS * CARD_W + (ROSTER_SLOTS - 1) * GAP;
    const x0 = (width - rowW) / 2 + CARD_W / 2;
    this.slots = [];
    for (let i = 0; i < ROSTER_SLOTS; i++) this.slots.push(this.makeSlot(x0 + i * (CARD_W + GAP), 230, registry[i] ?? null));

    this.total = label(this, width / 2, 370, '', { size: 14, mono: true, color: theme.textDim });
    label(this, width / 2, 420, '← → slot   ↑ ↓ level   Z all 0   X all 20   ENTER fight   ESC menu', {
      size: 11, mono: true, color: theme.textDim,
    });

    this.index = 0;
    this.refresh();
    const kb = this.input.keyboard!;
    const on = (keys: string[], fn: () => void) => keys.forEach((k) => kb.on(`keydown-${k}`, fn));
    on(['LEFT', 'A'], () => this.select(-1));
    on(['RIGHT', 'D'], () => this.select(1));
    on(['UP', 'W'], () => this.change(1));
    on(['DOWN', 'S'], () => this.change(-1));
    on(['Z'], () => this.setAll(0));
    on(['X'], () => this.setAll(20));
    on(['ENTER', 'SPACE'], () => go(this, 'Battle', { roster: { ...this.levels } }));
    on(['ESC'], () => go(this, 'Menu'));

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__roster = { levels: this.levels, scene: this };
    }
  }

  private makeSlot(x: number, y: number, entry: CharacterEntry | null): Slot {
    const card = this.add.container(x, y);
    const frame = this.add.graphics();
    const art = this.add.graphics();
    card.add([frame, art]);
    if (entry) {
      drawShape(art, entry.shape, 0, -48, 22, entry.color);
      card.add(label(this, 0, 0, entry.name.toUpperCase(), { size: 14, bold: true, color: entry.color }));
    } else {
      drawShape(art, 'square', 0, -48, 22, theme.locked, true);
      card.add(label(this, 0, -48, '?', { size: 18, bold: true, color: theme.locked }));
      card.add(label(this, 0, 0, 'LOCKED', { size: 13, bold: true, color: theme.locked }));
      card.add(label(this, 0, 18, 'coming soon', { size: 10, color: theme.locked }));
    }
    const level = label(this, 0, 52, '0', { size: 34, bold: true, mono: true, color: entry ? theme.text : theme.locked });
    card.add(level);
    card.add(label(this, 0, 80, 'LEVEL', { size: 9, color: theme.textDim }));
    return { entry, card, frame, level };
  }

  private select(d: number): void {
    this.index = (this.index + d + ROSTER_SLOTS) % ROSTER_SLOTS;
    this.refresh();
    pop(this, this.slots[this.index]!.card, 1.04);
  }

  private change(d: number): void {
    const slot = this.slots[this.index]!;
    if (!slot.entry) {
      nudge(this, slot.card); // locked: stays at 0
      return;
    }
    const id = slot.entry.id;
    const next = clampLevel((this.levels[id] ?? 0) + d, slot.entry);
    if (next === this.levels[id]) {
      nudge(this, slot.level);
      return;
    }
    this.levels[id] = next;
    this.refresh();
    pop(this, slot.level);
  }

  private setAll(level: number): void {
    for (const s of this.slots) {
      if (!s.entry) continue;
      this.levels[s.entry.id] = clampLevel(level, s.entry);
      pop(this, s.level);
    }
    this.refresh();
  }

  private refresh(): void {
    this.slots.forEach((s, i) => {
      const selected = i === this.index;
      const lv = s.entry ? (this.levels[s.entry.id] ?? 0) : 0;
      s.level.setText(String(lv));
      s.level.setColor(Phaser.Display.Color.IntegerToColor(s.entry ? (lv > 0 ? theme.text : theme.textDim) : theme.locked).rgba);
      s.frame.clear();
      s.frame.fillStyle(theme.panel, 1);
      s.frame.fillRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
      s.frame.lineStyle(selected ? 2 : 1, selected ? theme.boxBorder : theme.locked, 1);
      s.frame.strokeRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
      if (selected && s.entry) {
        s.frame.fillStyle(s.entry.color, 1);
        s.frame.fillRect(-CARD_W / 2, CARD_H / 2 - 4, CARD_W, 4);
      }
    });
    this.total.setText(`TOTAL DIFFICULTY  ${totalLevel(this.levels)}`);
  }
}
