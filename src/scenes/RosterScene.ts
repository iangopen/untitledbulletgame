import Phaser from 'phaser';
import { VIEW, theme, toCss } from '../render/theme';
import { lastRoster, normalizeRoster, rememberRoster, totalLevel, type Roster } from '../director/roster';
import { GRID_COLS, GRID_SLOTS, buildGrid, changeSlotLevel, moveInGrid, setAllLevels, type GridSlot } from '../menus/grid';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';

/** Grid geometry (layout px): portrait centers, size, and the level row beneath each portrait. */
const GRID_X0 = 84;
const GRID_Y0 = 150;
const COL_PITCH = 78;
const ROW_PITCH = 110;
const LEVEL_DY = 50;
/** Side panel (info, set all, difficulty, fight, back), left edge. */
const PANEL_X = 900;
/** Wheel delta per level step: one mouse-wheel notch (deltaY 100) = one level; trackpads accumulate. */
const WHEEL_STEP = 100;

const PANEL = ['set all to 0', 'set all to 20', 'Fight', 'Back'] as const;

interface Cell {
  slot: GridSlot;
  el: HTMLElement;
  level: HTMLElement | null;
}

/**
 * Custom (scene key 'Roster'): a UCN-style 10x5 grid of portraits, generated from the registry
 * (menus/grid.ts), with an info panel and a side panel. One selection index for the screen:
 * 0..49 = grid slots, 50.. = panel items. Hover selects; the info panel shows the last grid slot selected.
 * Mouse: click a slot's ‹ › or use the wheel over it to change its level; click panel items.
 * Keyboard: WASD move on the grid, arrows change the selected slot's level (↑ → up, ↓ ← down),
 * Tab switches grid / panel (W S or ↑ ↓ in the panel, Enter activates), Z / X all 0 / 20,
 * Enter fights from the grid, Esc back to the menu.
 */
export class RosterScene extends Phaser.Scene {
  private levels: Roster = {};
  private grid: GridSlot[] = [];
  private cells: Cell[] = [];
  private panel: HTMLElement[] = [];
  private sel = 0;
  /** Last grid slot selected (the info panel shows it while the side panel has focus). */
  private gridSel = 0;
  private wheelAcc = 0;
  private infoTitle!: HTMLElement;
  private infoDesc!: HTMLElement;
  private total!: HTMLElement;

  constructor() {
    super('Roster');
  }

  create(data: { roster?: Roster } = {}): void {
    enter(this);
    this.levels = normalizeRoster(data.roster ?? lastRoster());
    rememberRoster(this.levels);
    this.grid = buildGrid();
    const screen = h('div');
    screen.append(at(h('div', 't-label', 'Custom'), GRID_X0 - 32, 56, 'left'));

    this.cells = this.grid.map((slot) => this.makeCell(slot));
    for (const c of this.cells) screen.append(c.el);

    // Info panel (fixed area): full name and a short vague line from the character's config.
    this.infoTitle = at(h('div', 't-label'), PANEL_X, 166, 'left');
    this.infoDesc = h('div', 'info-desc t-small dim');
    this.infoDesc.style.left = `${PANEL_X}px`;
    this.infoDesc.style.top = '196px';
    screen.append(this.infoTitle, this.infoDesc);

    const ys = [380, 424, 560, 610];
    this.panel = PANEL.map((label, i) => {
      const el = at(h('div', `opt ${i === 2 ? 't-label' : 't-body'} click`), PANEL_X, ys[i]!, 'left');
      el.append(h('span', 'dot'), h('span', '', label));
      el.addEventListener('mouseenter', () => this.select(GRID_SLOTS + i));
      el.addEventListener('click', () => {
        this.select(GRID_SLOTS + i);
        this.activate(i);
      });
      screen.append(el);
      return el;
    });
    this.total = at(h('div', 't-small mono muted'), PANEL_X, 488, 'left');
    screen.append(
      this.total,
      at(h('div', 't-hint', 'wasd choose    arrows level    z / x  all 0 / 20    tab panel    enter fight    esc back'), VIEW.cx, VIEW.height - 24),
    );
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
    on(['UP'], () => (this.inPanel ? this.move(0, -1) : this.change(this.sel, 1)));
    on(['DOWN'], () => (this.inPanel ? this.move(0, 1) : this.change(this.sel, -1)));
    on(['RIGHT'], () => (this.inPanel ? undefined : this.change(this.sel, 1)));
    on(['LEFT'], () => (this.inPanel ? undefined : this.change(this.sel, -1)));
    kb.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.select(this.inPanel ? this.gridSel : GRID_SLOTS + 2);
    });
    on(['Z'], () => this.setAll(0));
    on(['X'], () => this.setAll(20));
    on(['ENTER'], () => (this.inPanel ? this.activate(this.sel - GRID_SLOTS) : this.start()));
    on(['ESC'], () => go(this, 'Menu'));

    (window as unknown as Record<string, unknown>).__custom = { scene: this, levels: () => this.levels, sel: () => this.sel };
  }

  private get inPanel(): boolean {
    return this.sel >= GRID_SLOTS;
  }

  private makeCell(slot: GridSlot): Cell {
    const col = slot.index % GRID_COLS;
    const row = Math.floor(slot.index / GRID_COLS);
    const x = GRID_X0 + col * COL_PITCH;
    const y = GRID_Y0 + row * ROW_PITCH;
    const el = h('div', `cell${slot.entry ? '' : ' locked'}`);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const portrait = h('div', `portrait ${slot.entry ? 'click' : 'no'}`);
    el.append(portrait);
    let level: HTMLElement | null = null;
    if (slot.entry) {
      el.style.setProperty('--accent', toCss(slot.entry.color));
      portrait.append(shape(slot.entry.shape, slot.entry.color, 20));
      level = at(h('div', 'level t-small mono', '0'), 0, LEVEL_DY);
      const down = at(h('div', 'arrow click', '‹'), -26, LEVEL_DY);
      const up = at(h('div', 'arrow click', '›'), 26, LEVEL_DY);
      down.addEventListener('click', () => this.change(slot.index, -1));
      up.addEventListener('click', () => this.change(slot.index, 1));
      el.append(level, down, up, h('div', 'uline'));
      el.addEventListener('wheel', (e) => this.wheel(slot.index, e));
    }
    // Hover and click select (placeholders too, so their info shows; they ignore level changes).
    portrait.addEventListener('mouseenter', () => this.select(slot.index));
    portrait.addEventListener('click', () => this.select(slot.index));
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
    if (this.inPanel) {
      const n = PANEL.length;
      if (dy) this.select(GRID_SLOTS + ((this.sel - GRID_SLOTS + dy + n) % n));
      return;
    }
    this.select(moveInGrid(this.sel, dx, dy));
    replay(this.cells[this.sel]!.el.firstElementChild!, 'pop');
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
      replay(cell.level ?? cell.el.firstElementChild!, 'nudge'); // locked or at a limit
      return;
    }
    this.levels = next;
    rememberRoster(next);
    this.render();
    replay(cell.level!, 'pop');
  }

  private setAll(level: number): void {
    this.levels = setAllLevels(this.grid, level);
    rememberRoster(this.levels);
    for (const c of this.cells) if (c.level) replay(c.level, 'pop');
    this.render();
  }

  private activate(i: number): void {
    if (i === 0) this.setAll(0);
    else if (i === 1) this.setAll(20);
    else if (i === 2) this.start();
    else go(this, 'Menu');
  }

  private start(): void {
    go(this, 'Battle', { roster: { ...this.levels } });
  }

  private render(): void {
    for (const c of this.cells) {
      c.el.classList.toggle('sel', c.slot.index === this.sel);
      c.el.classList.toggle('last', c.slot.index === this.gridSel && this.inPanel);
      if (c.slot.entry && c.level) {
        const lv = this.levels[c.slot.entry.id] ?? 0;
        c.level.textContent = String(lv);
        c.el.classList.toggle('zero', lv === 0);
      }
    }
    this.panel.forEach((p, i) => p.classList.toggle('sel', this.sel === GRID_SLOTS + i));
    const info = this.grid[this.gridSel]!;
    this.infoTitle.textContent = info.title;
    this.infoTitle.style.color = info.entry ? toCss(info.entry.color) : toCss(theme.textMuted);
    this.infoDesc.textContent = info.description;
    this.total.textContent = `difficulty ${totalLevel(this.levels)}`;
  }
}
