import Phaser from 'phaser';
import { VIEW, theme, toCss } from '../render/theme';
import { registry, ROSTER_SLOTS, type CharacterEntry } from '../characters/registry';
import { DEFAULT_ROSTER, clampLevel, normalizeRoster, totalLevel, type Roster } from '../director/roster';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { abilityIcon } from '../ui/dom';
import { ACTIVE_INFO, PASSIVE_INFO, browserStorage, loadLoadout, saveLoadout, type AbilityInfo, type Loadout } from '../abilities/loadout';

/** Loadout picker rows (y in the layout), option spacing. Row 0 of the selection is the character slots. */
const ACTIVE_Y = 420;
const PASSIVE_Y = 482;
const DESC_Y = 530;
const OPT_GAP = 150;
const SLOT_SHIFT = -110;

interface PickRow {
  key: 'active' | 'passive';
  list: readonly AbilityInfo[];
  label: HTMLElement;
  opts: HTMLElement[];
}

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
 * Loadout picker (below the slots): an active row and a passive row. Tab / Shift+Tab moves between
 * rows (the slots are row 0); on a loadout row ← → equip the previous / next
 * option (saved at once), ↑ ↓ move between rows. Mouse: hover shows an option's description, click
 * equips it. The focused row and its option share the screen's one selection state.
 */
export class RosterScene extends Phaser.Scene {
  private levels: Record<string, number> = {};
  private slots: Slot[] = [];
  private index = 0;
  private total!: HTMLElement;
  private fight!: HTMLElement;
  private wheelAcc = 0;
  /** Focused row: 0 = character slots, 1 = active, 2 = passive. */
  private row = 0;
  private loadout: Loadout = { active: null, passive: null };
  private pick: PickRow[] = [];
  private desc!: HTMLElement;
  /** Option hovered by the mouse (row, index), for its description; null = show the focused row's. */
  private hover: [number, number] | null = null;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = { ...normalizeRoster(data.roster ?? DEFAULT_ROSTER) };
    const screen = h('div');
    screen.append(at(h('div', 't-label dim', 'Choose your opponents'), VIEW.cx, 70));

    const x0 = VIEW.cx - ((ROSTER_SLOTS - 1) * SLOT_GAP) / 2;
    this.slots = [];
    for (let i = 0; i < ROSTER_SLOTS; i++) {
      const slot = this.makeSlot(i, x0 + i * SLOT_GAP, registry[i] ?? null);
      slot.el.style.top = `${SLOT_SHIFT}px`; // slots sit higher to make room for the loadout picker
      screen.append(slot.el);
      this.slots.push(slot);
    }

    this.loadout = loadLoadout(browserStorage());
    this.pick = [this.makePickRow(screen, 'active', ACTIVE_INFO, ACTIVE_Y), this.makePickRow(screen, 'passive', PASSIVE_INFO, PASSIVE_Y)];
    this.desc = at(h('div', 't-small muted'), VIEW.cx, DESC_Y);
    screen.append(this.desc);
    this.row = 0;
    this.hover = null;

    this.total = at(h('div', 't-small mono muted'), VIEW.cx, 580);
    this.fight = at(h('div', 'opt t-label click'), VIEW.cx, 628);
    this.fight.append(h('span', 'dot'), h('span', '', 'Fight'));
    this.fight.addEventListener('mouseenter', () => this.fight.classList.add('sel'));
    this.fight.addEventListener('mouseleave', () => this.fight.classList.remove('sel'));
    this.fight.addEventListener('click', () => this.start());
    screen.append(
      this.total,
      this.fight,
      at(h('div', 't-hint', '← → choose    ↑ ↓ level    tab loadout    z / x  all 0 / 20    enter fight    esc back'), VIEW.cx, VIEW.height - 40),
    );
    mountScreen(this, screen);

    this.index = 0;
    this.render();
    const kb = this.input.keyboard!;
    const on = (keys: string[], fn: () => void) => keys.forEach((k) => kb.on(`keydown-${k}`, fn));
    on(['LEFT', 'A'], () => (this.row === 0 ? this.select(this.index - 1) : this.cycle(this.row, -1)));
    on(['RIGHT', 'D'], () => (this.row === 0 ? this.select(this.index + 1) : this.cycle(this.row, 1)));
    on(['UP', 'W'], () => (this.row === 0 ? this.change(this.index, 1) : this.setRow(this.row - 1)));
    on(['DOWN', 'S'], () => (this.row === 0 ? this.change(this.index, -1) : this.setRow(this.row + 1)));
    kb.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.setRow((this.row + (e.shiftKey ? 2 : 1)) % 3);
    });
    on(['Z'], () => this.setAll(0));
    on(['X'], () => this.setAll(20));
    on(['ENTER', 'SPACE'], () => this.start());
    on(['ESC'], () => go(this, 'Menu'));

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__roster = { levels: this.levels, scene: this, loadout: () => this.loadout };
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

  private makePickRow(screen: HTMLElement, key: 'active' | 'passive', list: readonly AbilityInfo[], y: number): PickRow {
    const rowIdx = key === 'active' ? 1 : 2;
    const x0 = VIEW.cx - ((list.length - 1) * OPT_GAP) / 2;
    const label = at(h('div', 'lrow-label t-small', key), x0 - 120, y, 'right');
    screen.append(label);
    const opts = list.map((a, i) => {
      const el = at(h('div', 'lopt t-small click'), x0 + i * OPT_GAP, y);
      el.title = a.desc;
      el.append(h('span', 'dot'), abilityIcon(a.id), h('span', '', a.name), h('span', 'uline'));
      el.addEventListener('mouseenter', () => {
        this.hover = [rowIdx, i];
        this.render();
      });
      el.addEventListener('mouseleave', () => {
        this.hover = null;
        this.render();
      });
      el.addEventListener('click', () => {
        this.setRow(rowIdx);
        this.equip(rowIdx, i);
      });
      screen.append(el);
      return el;
    });
    return { key, list, label, opts };
  }

  private setRow(r: number): void {
    const next = Math.max(0, Math.min(2, r));
    if (next === this.row) return;
    this.row = next;
    this.render();
  }

  /** Equip option i of a loadout row and save at once. */
  private equip(rowIdx: number, i: number): void {
    const pr = this.pick[rowIdx - 1]!;
    const a = pr.list[i]!;
    if (this.loadout[pr.key] !== a.id) {
      this.loadout = { ...this.loadout, [pr.key]: a.id };
      saveLoadout(browserStorage(), this.loadout);
      replay(pr.opts[i]!, 'pop');
    }
    this.render();
  }

  private cycle(rowIdx: number, d: number): void {
    const pr = this.pick[rowIdx - 1]!;
    const cur = Math.max(0, pr.list.findIndex((a) => a.id === this.loadout[pr.key]));
    this.equip(rowIdx, (cur + d + pr.list.length) % pr.list.length);
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
    if (this.row !== 0) {
      this.row = 0;
      this.render();
    }
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
    // Loadout rows: equipped option bright and underlined; the focused row's label is bright.
    this.pick.forEach((pr, r) => {
      const focus = this.row === r + 1;
      pr.label.classList.toggle('focus', focus);
      pr.list.forEach((a, i) => {
        const el = pr.opts[i]!;
        el.classList.toggle('eq', a.id === this.loadout[pr.key]);
        el.classList.toggle('focus', focus);
      });
    });
    // One description line: the hovered option, else the equipped option of the focused row (or the active's).
    const [hr, hi] = this.hover ?? [this.row === 2 ? 2 : 1, -1];
    const pr = this.pick[hr - 1]!;
    const a = hi >= 0 ? pr.list[hi]! : pr.list.find((x) => x.id === this.loadout[pr.key]) ?? pr.list[pr.list.length - 1]!;
    this.desc.textContent = `${a.name}: ${a.desc}`;
  }
}
