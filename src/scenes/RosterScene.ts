import Phaser from 'phaser';
import { VIEW, theme, toCss } from '../render/theme';
import { registry, ROSTER_SLOTS, type CharacterEntry } from '../characters/registry';
import { DEFAULT_ROSTER, clampLevel, normalizeRoster, totalLevel, type Roster } from '../director/roster';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';

interface Slot {
  entry: CharacterEntry | null; // null = locked placeholder
  el: HTMLElement;
  level: HTMLElement | null;
}

/** Horizontal distance between slot centers. */
const SLOT_GAP = 200;
const SHAPE_Y = 300;
const NAME_Y = 372;
const LEVEL_Y = 432;
/** Wheel delta per level step: one mouse-wheel notch (deltaY 100) = one level; trackpads accumulate. */
const WHEEL_STEP = 100;

/**
 * UCN-style roster, minimal: shape, name and level per slot; the selected slot is bright and underlined.
 * Mouse: hover or click a slot selects it, its arrows or the wheel change its level, Fight starts.
 * Keyboard: ← → select, ↑ ↓ level, Z / X all 0 / 20, Enter fight, Esc back. One selection state.
 */
export class RosterScene extends Phaser.Scene {
  private levels: Record<string, number> = {};
  private slots: Slot[] = [];
  private index = 0;
  private total!: HTMLElement;
  private fight!: HTMLElement;
  private wheelAcc = 0;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = { ...normalizeRoster(data.roster ?? DEFAULT_ROSTER) };
    const screen = h('div');
    screen.append(at(h('div', 't-label dim', 'Choose your opponents'), VIEW.cx, 150));

    const x0 = VIEW.cx - ((ROSTER_SLOTS - 1) * SLOT_GAP) / 2;
    this.slots = [];
    for (let i = 0; i < ROSTER_SLOTS; i++) {
      const slot = this.makeSlot(i, x0 + i * SLOT_GAP, registry[i] ?? null);
      screen.append(slot.el);
      this.slots.push(slot);
    }

    this.total = at(h('div', 't-small mono muted'), VIEW.cx, 545);
    this.fight = at(h('div', 'opt t-label click'), VIEW.cx, 610);
    this.fight.append(h('span', 'dot'), h('span', '', 'Fight'));
    this.fight.addEventListener('mouseenter', () => this.fight.classList.add('sel'));
    this.fight.addEventListener('mouseleave', () => this.fight.classList.remove('sel'));
    this.fight.addEventListener('click', () => this.start());
    screen.append(
      this.total,
      this.fight,
      at(h('div', 't-hint', '← → choose    ↑ ↓ level    z / x  all 0 / 20    enter fight    esc back'), VIEW.cx, VIEW.height - 40),
    );
    mountScreen(this, screen);

    this.index = 0;
    this.render();
    const kb = this.input.keyboard!;
    const on = (keys: string[], fn: () => void) => keys.forEach((k) => kb.on(`keydown-${k}`, fn));
    on(['LEFT', 'A'], () => this.select(this.index - 1));
    on(['RIGHT', 'D'], () => this.select(this.index + 1));
    on(['UP', 'W'], () => this.change(this.index, 1));
    on(['DOWN', 'S'], () => this.change(this.index, -1));
    on(['Z'], () => this.setAll(0));
    on(['X'], () => this.setAll(20));
    on(['ENTER', 'SPACE'], () => this.start());
    on(['ESC'], () => go(this, 'Menu'));

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__roster = { levels: this.levels, scene: this };
    }
  }

  private makeSlot(i: number, x: number, entry: CharacterEntry | null): Slot {
    const el = h('div', entry ? 'slot' : 'slot locked');
    el.style.left = `${x}px`;
    const hit = h('div', `hit ${entry ? 'click' : 'no'}`);
    el.append(hit);
    let level: HTMLElement | null = null;
    if (entry) {
      el.append(
        at(shape(entry.shape, entry.color, 34), 0, SHAPE_Y),
        at(h('div', 'name t-body', entry.name), 0, NAME_Y),
      );
      level = at(h('div', 'level t-number mono', '0'), 0, LEVEL_Y);
      const up = at(h('div', 'arrow click', '▲'), 52, LEVEL_Y - 14);
      const down = at(h('div', 'arrow click', '▼'), 52, LEVEL_Y + 14);
      up.addEventListener('click', () => this.change(i, 1));
      down.addEventListener('click', () => this.change(i, -1));
      const underline = h('div', 'underline');
      underline.style.background = toCss(entry.color);
      el.append(level, up, down, underline);
      // Hover and click select the slot (shared with the keyboard); the wheel changes its level.
      hit.addEventListener('mouseenter', () => this.select(i));
      hit.addEventListener('click', () => this.select(i));
      el.addEventListener('wheel', (e) => this.wheel(i, e));
    } else {
      // Locked: a faint outline and one dim word; ignores the mouse (not-allowed cursor).
      el.append(at(shape('square', theme.locked, 30, true), 0, SHAPE_Y), at(h('div', 'name', 'locked'), 0, NAME_Y));
    }
    return { entry, el, level };
  }

  private wheel(i: number, e: WheelEvent): void {
    this.select(i);
    this.wheelAcc += e.deltaY;
    while (Math.abs(this.wheelAcc) >= WHEEL_STEP) {
      const dir = this.wheelAcc < 0 ? 1 : -1; // wheel up = level up
      this.wheelAcc += dir * WHEEL_STEP;
      this.change(i, dir);
    }
  }

  private select(i: number): void {
    const next = (i + ROSTER_SLOTS) % ROSTER_SLOTS;
    if (next === this.index) return;
    this.index = next;
    this.wheelAcc = 0;
    this.render();
  }

  private change(i: number, d: number): void {
    this.select(i);
    const slot = this.slots[this.index]!;
    if (!slot.entry || !slot.level) {
      replay(slot.el, 'nudge'); // locked: stays at 0
      return;
    }
    const id = slot.entry.id;
    const next = clampLevel((this.levels[id] ?? 0) + d, slot.entry);
    if (next === this.levels[id]) {
      replay(slot.level, 'nudge');
      return;
    }
    this.levels[id] = next;
    this.render();
    replay(slot.level, 'pop');
  }

  private setAll(level: number): void {
    for (const s of this.slots) {
      if (!s.entry || !s.level) continue;
      this.levels[s.entry.id] = clampLevel(level, s.entry);
      replay(s.level, 'pop');
    }
    this.render();
  }

  private start(): void {
    go(this, 'Battle', { roster: { ...this.levels } });
  }

  private render(): void {
    this.slots.forEach((s, i) => {
      s.el.classList.toggle('sel', i === this.index);
      if (s.entry && s.level) {
        const lv = this.levels[s.entry.id] ?? 0;
        s.level.textContent = String(lv);
        s.level.classList.toggle('zero', lv === 0);
      }
    });
    this.total.textContent = `difficulty ${totalLevel(this.levels)}`;
  }
}
