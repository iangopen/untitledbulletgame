import Phaser from 'phaser';
import { VIEW, line, theme, type } from '../render/theme';
import { registry, ROSTER_SLOTS, type CharacterEntry } from '../characters/registry';
import { DEFAULT_ROSTER, clampLevel, normalizeRoster, totalLevel, type Roster } from '../director/roster';
import { drawShape, enter, go, hint, label, nudge, pop, setColor } from './ui';

interface Slot {
  entry: CharacterEntry | null; // null = locked placeholder
  group: Phaser.GameObjects.Container;
  level: Phaser.GameObjects.Text | null;
}

/** Horizontal distance between slot centers. */
const SLOT_GAP = 200;
const SHAPE_Y = 300;
const NAME_Y = 372;
const LEVEL_Y = 432;
const UNDERLINE_Y = 470;
const DIM_ALPHA = 0.4;

/** UCN-style roster, minimal: shape, name and level per slot; the selected slot is bright and underlined. */
export class RosterScene extends Phaser.Scene {
  private levels: Record<string, number> = {};
  private slots: Slot[] = [];
  private index = 0;
  private total!: Phaser.GameObjects.Text;
  private underline!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = { ...normalizeRoster(data.roster ?? DEFAULT_ROSTER) };
    label(this, VIEW.cx, 150, 'Choose your opponents', { size: type.label, color: theme.textDim });

    const x0 = VIEW.cx - ((ROSTER_SLOTS - 1) * SLOT_GAP) / 2;
    this.slots = [];
    for (let i = 0; i < ROSTER_SLOTS; i++) this.slots.push(this.makeSlot(x0 + i * SLOT_GAP, registry[i] ?? null));
    this.underline = this.add.graphics();

    this.total = label(this, VIEW.cx, 560, '', { size: type.small, mono: true, color: theme.textMuted });
    hint(this, '← → choose    ↑ ↓ level    z / x  all 0 / 20    enter start    esc back');

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

  private makeSlot(x: number, entry: CharacterEntry | null): Slot {
    const group = this.add.container(x, 0);
    const art = this.add.graphics();
    group.add(art);
    let level: Phaser.GameObjects.Text | null = null;
    if (entry) {
      drawShape(art, entry.shape, 0, SHAPE_Y, 34, entry.color);
      group.add(label(this, 0, NAME_Y, entry.name, { size: type.body }));
      level = label(this, 0, LEVEL_Y, '0', { size: type.number, mono: true });
      group.add(level);
    } else {
      // Locked: a faint outline and one dim word.
      drawShape(art, 'square', 0, SHAPE_Y, 30, theme.locked, true);
      group.add(label(this, 0, NAME_Y, 'locked', { size: type.small, color: theme.locked }));
    }
    return { entry, group, level };
  }

  private select(d: number): void {
    this.index = (this.index + d + ROSTER_SLOTS) % ROSTER_SLOTS;
    this.refresh();
  }

  private change(d: number): void {
    const slot = this.slots[this.index]!;
    if (!slot.entry || !slot.level) {
      nudge(this, slot.group); // locked: stays at 0
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
      if (!s.entry || !s.level) continue;
      this.levels[s.entry.id] = clampLevel(level, s.entry);
      pop(this, s.level);
    }
    this.refresh();
  }

  private refresh(): void {
    this.slots.forEach((s, i) => {
      const selected = i === this.index;
      s.group.setAlpha(selected ? 1 : s.entry ? DIM_ALPHA : 1);
      if (s.entry && s.level) {
        const lv = this.levels[s.entry.id] ?? 0;
        s.level.setText(String(lv));
        setColor(s.level, lv > 0 ? theme.text : theme.textDim);
      }
    });
    // Thin accent underline under the selected slot (character color, or muted for locked).
    const sel = this.slots[this.index]!;
    const w = 72;
    this.underline.clear();
    this.underline.fillStyle(sel.entry ? sel.entry.color : theme.textMuted, 1);
    this.underline.fillRect(Math.round(sel.group.x - w / 2), UNDERLINE_Y, w, line.thin);
    this.total.setText(`difficulty ${totalLevel(this.levels)}`);
  }
}
