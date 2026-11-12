import Phaser from 'phaser';
import { VIEW, theme, toCss } from '../render/theme';
import { lastRoster, normalizeRoster, rememberRoster, type Roster } from '../director/roster';
import {
  GRID_COLS, GRID_ROWS, GRID_SLOTS, addAllLevels, buildGrid, changeSlotLevel, moveInGrid, pointValue, setAllLevels, type GridSlot,
} from '../menus/grid';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { settings } from '../settings/store';

/**
 * Layout (1280x720 layout px). The grid is one uniform block of square portraits packed edge to
 * edge: a CSS grid of CELL x CELL cells with LINE px rules between them (the container's
 * background shows through the gaps), so every portrait is exactly the same size at any scale.
 */
export const CELL = 86;
export const LINE = 2;
export const GRID_X = 24;
export const GRID_Y = 96;
export const GRID_W = GRID_COLS * CELL + (GRID_COLS + 1) * LINE; // 882
export const GRID_H = GRID_ROWS * CELL + (GRID_ROWS + 1) * LINE; // 442
/** Right column, left edge. */
const COL_X = 940;
/** Info panel (under the grid). */
const INFO_Y = GRID_Y + GRID_H + 30;
/** Wheel delta per level step: one mouse-wheel notch (deltaY 100) = one level; trackpads accumulate. */
const WHEEL_STEP = 100;

type Action = { label: string; y: number; cls: string; run: (s: RosterScene) => void };
const ACTIONS: Action[] = [
  { label: 'Set all 0', y: 150, cls: 't-body', run: (s) => s.setAll(0) },
  { label: 'Add all 1', y: 188, cls: 't-body', run: (s) => s.addAll(1) },
  { label: 'Set all 5', y: 226, cls: 't-body', run: (s) => s.setAll(5) },
  { label: 'Set all 10', y: 264, cls: 't-body', run: (s) => s.setAll(10) },
  { label: 'Set all 20', y: 302, cls: 't-body', run: (s) => s.setAll(20) },
  { label: 'Char info', y: 500, cls: 't-body', run: (s) => s.toggleInfo() },
  { label: 'Go', y: 588, cls: 't-title', run: (s) => s.start() },
  { label: 'Back', y: 650, cls: 't-small', run: (s) => go(s, 'Menu') },
];
const GO = ACTIONS.findIndex((a) => a.label === 'Go');

interface Cell {
  slot: GridSlot;
  el: HTMLElement;
  level: HTMLElement | null;
}

/**
 * Custom (scene key 'Roster'), laid out like UCN's custom night screen: a 10x5 block of uniform
 * portraits on the left (generated from the registry, menus/grid.ts), the title, level buttons,
 * readouts, the Char info toggle and Go on the right. One selection index: 0..49 = portraits,
 * 50.. = right-column items. Hover selects (after the mouse moves, UiLayer); the selected real
 * portrait shows ‹ › on its lower edge, which lower / raise its level; the wheel over a portrait
 * changes it too. Keyboard: WASD move on the grid, arrows change the selected level (↑ → up,
 * ↓ ← down), Tab switches grid / column (↑ ↓ / W S and Enter there), Z / X set all 0 / 20,
 * Enter fights from the grid, Esc back to the menu.
 */
export class RosterScene extends Phaser.Scene {
  private levels: Roster = {};
  private grid: GridSlot[] = [];
  private cells: Cell[] = [];
  private items: HTMLElement[] = [];
  private sel = 0;
  private gridSel = 0;
  private wheelAcc = 0;
  private info!: HTMLElement;
  private infoTitle!: HTMLElement;
  private infoDesc!: HTMLElement;
  private points!: HTMLElement;
  private infoVal!: HTMLElement;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = normalizeRoster(data.roster ?? lastRoster());
    rememberRoster(this.levels);
    this.grid = buildGrid();
    const screen = h('div');

    const block = h('div', 'ugrid');
    Object.assign(block.style, { left: `${GRID_X}px`, top: `${GRID_Y}px`, width: `${GRID_W}px`, height: `${GRID_H}px` });
    this.cells = this.grid.map((slot) => this.makeCell(slot));
    for (const c of this.cells) block.append(c.el);
    screen.append(block);

    // Info panel (shown only with Char info on): full name and description from the config.
    this.info = h('div', 'uinfo');
    Object.assign(this.info.style, { left: `${GRID_X}px`, top: `${INFO_Y}px` });
    this.infoTitle = h('div', 't-label');
    this.infoDesc = h('div', 't-small dim');
    this.info.append(this.infoTitle, this.infoDesc);
    screen.append(this.info);

    // Right column.
    screen.append(at(h('div', 't-title', 'Custom'), COL_X, 64, 'left'));
    this.items = ACTIONS.map((a, i) => {
      const el = at(h('div', `opt ${a.cls} click`), COL_X, a.y, 'left');
      el.append(h('span', 'dot'), h('span', '', a.label));
      el.addEventListener('mouseenter', () => this.select(GRID_SLOTS + i));
      el.addEventListener('click', () => {
        this.select(GRID_SLOTS + i);
        a.run(this);
      });
      screen.append(el);
      return el;
    });
    this.infoVal = h('span', 'note mono');
    this.items[ACTIONS.findIndex((a) => a.label === 'Char info')]!.append(this.infoVal);
    const readout = (label: string, y: number) => {
      const v = h('span', 'mono');
      const row = at(h('div', 'readrow t-small'), COL_X, y, 'left');
      row.append(h('span', 'muted', label), v);
      screen.append(row);
      return v;
    };
    this.points = readout('Point value', 370);
    readout('High score', 404).textContent = '—';
    readout('Best time', 438).textContent = '—';
    screen.append(at(h('div', 't-hint', 'wasd choose    arrows level    z / x  all 0 / 20    tab menu    enter go    esc back'), GRID_X + GRID_W / 2, VIEW.height - 20));
    mountScreen(this, screen);

    this.sel = 0;
    this.gridSel = 0;
    this.render();
    const kb = this.input.keyboard!;
    const on = (keys: string[], fn: () => void) => keys.forEach((k) => kb.on(`keydown-${k}`, fn));
    on(['A'], () => this.move(-1, 0));
    on(['D'], () => this.move(1, 0));
    on(['W'], () => this.move(0, -1));
    on(['S'], () => this.move(0, 1));
    on(['UP'], () => (this.inColumn ? this.move(0, -1) : this.change(this.sel, 1)));
    on(['DOWN'], () => (this.inColumn ? this.move(0, 1) : this.change(this.sel, -1)));
    on(['RIGHT'], () => (this.inColumn ? undefined : this.change(this.sel, 1)));
    on(['LEFT'], () => (this.inColumn ? undefined : this.change(this.sel, -1)));
    kb.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.select(this.inColumn ? this.gridSel : GRID_SLOTS + GO);
    });
    on(['Z'], () => this.setAll(0));
    on(['X'], () => this.setAll(20));
    on(['ENTER'], () => (this.inColumn ? ACTIONS[this.sel - GRID_SLOTS]!.run(this) : this.start()));
    on(['ESC'], () => go(this, 'Menu'));

    (window as unknown as Record<string, unknown>).__custom = { scene: this, levels: () => this.levels, sel: () => this.sel };
  }

  private get inColumn(): boolean {
    return this.sel >= GRID_SLOTS;
  }

  private makeCell(slot: GridSlot): Cell {
    const el = h('div', `ucell ${slot.entry ? 'real click' : 'ph no'}`);
    let level: HTMLElement | null = null;
    if (slot.entry) {
      el.append(shape(slot.entry.shape, slot.entry.color, 24));
      level = h('div', 'ulv mono', '0');
      const down = h('div', 'uarrow l click', '‹');
      const up = h('div', 'uarrow r click', '›');
      down.addEventListener('click', (e) => {
        e.stopPropagation();
        this.change(slot.index, -1);
      });
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        this.change(slot.index, 1);
      });
      el.append(level, down, up);
      el.addEventListener('wheel', (e) => this.wheel(slot.index, e));
    }
    // Hover and click select (placeholders too, so their info shows; they have no level).
    el.addEventListener('mouseenter', () => this.select(slot.index));
    el.addEventListener('click', () => this.select(slot.index));
    return { slot, el, level };
  }

  private select(i: number): void {
    if (i === this.sel) return;
    this.sel = i;
    if (i < GRID_SLOTS) this.gridSel = i;
    this.wheelAcc = 0;
    this.render();
  }

  private move(dx: number, dy: number): void {
    if (this.inColumn) {
      const n = ACTIONS.length;
      if (dy) this.select(GRID_SLOTS + ((this.sel - GRID_SLOTS + dy + n) % n));
      return;
    }
    this.select(moveInGrid(this.sel, dx, dy));
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

  private change(i: number, d: number): void {
    this.select(i);
    const cell = this.cells[i]!;
    const next = changeSlotLevel(this.levels, cell.slot, d);
    if (!next) {
      replay(cell.level ?? cell.el, 'nudge'); // placeholder or at a limit
      return;
    }
    this.setLevels(next);
    replay(cell.level!, 'pop');
  }

  private setLevels(r: Roster): void {
    this.levels = r;
    rememberRoster(r);
    this.render();
  }

  setAll(level: number): void {
    this.setLevels(setAllLevels(this.grid, level));
    for (const c of this.cells) if (c.level) replay(c.level, 'pop');
  }

  addAll(d: number): void {
    this.setLevels(addAllLevels(this.levels, this.grid, d));
    for (const c of this.cells) if (c.level) replay(c.level, 'pop');
  }

  toggleInfo(): void {
    settings.set({ charInfo: !settings.current.charInfo });
    this.render();
  }

  start(): void {
    go(this, 'Battle', { roster: { ...this.levels } });
  }

  private render(): void {
    for (const c of this.cells) {
      c.el.classList.toggle('sel', c.slot.index === this.sel);
      if (c.slot.entry && c.level) {
        const lv = this.levels[c.slot.entry.id] ?? 0;
        c.level.textContent = String(lv);
        c.el.classList.toggle('zero', lv === 0);
      }
    }
    this.items.forEach((p, i) => p.classList.toggle('sel', this.sel === GRID_SLOTS + i));
    const on = settings.current.charInfo;
    this.infoVal.textContent = on ? 'on' : 'off';
    this.info.style.visibility = on ? '' : 'hidden';
    const info = this.grid[this.gridSel]!;
    this.infoTitle.textContent = info.title;
    this.infoTitle.style.color = info.entry ? toCss(info.entry.color) : toCss(theme.textMuted);
    this.infoDesc.textContent = info.description;
    this.points.textContent = String(pointValue(this.levels));
  }
}
