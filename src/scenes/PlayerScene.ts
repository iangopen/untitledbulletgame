import Phaser from 'phaser';
import { VIEW } from '../render/theme';
import { at, abilityIcon, h, replay } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { browserStorage, loadLoadout, type Loadout } from '../abilities/loadout';
import { SLOT_OPTIONS, cycleOption, pickAndSave, type LoadoutSlot } from '../menus/loadoutPick';

/**
 * Layout (layout px). The screen is a column of sections under the title; the loadout is the first.
 * Reserved for Phase 8, deliberately empty now: the top-right corner (currency, right-aligned at
 * CURRENCY_X, TITLE_Y) and a section below the loadout starting at SHOP_Y (shop rows). Adding them
 * means appending elements and selection rows, not moving the loadout.
 */
const LEFT = 84;
const TITLE_Y = 56;
const LOADOUT_Y = 150;
const ROW_Y: Record<LoadoutSlot, number> = { active: 220, passive: 290 };
const DESC_Y = 350;
export const SHOP_Y = 430;
export const CURRENCY_X = VIEW.width - LEFT;
const OPT_X0 = 270;
const OPT_GAP = 170;
const BACK_Y = 640;

const SLOTS: LoadoutSlot[] = ['active', 'passive'];

interface PickRow {
  slot: LoadoutSlot;
  label: HTMLElement;
  opts: HTMLElement[];
}

/**
 * Player: the loadout picker (moved here from the roster screen). One selection state: the focused
 * row (active, passive, back). Keyboard: ↑ ↓ / W S move rows, ← → / A D equip the previous / next
 * option (saved at once), Enter on Back or Esc returns to the menu. Mouse: hover shows an option's
 * description, click equips it; Back is clickable.
 */
export class PlayerScene extends Phaser.Scene {
  private loadout: Loadout = { active: null, passive: null };
  private rows: PickRow[] = [];
  private back!: HTMLElement;
  private desc!: HTMLElement;
  /** 0 = active, 1 = passive, 2 = back. */
  private row = 0;
  private hover: [LoadoutSlot, number] | null = null;

  constructor() {
    super('Player');
  }

  create(): void {
    enter(this);
    this.loadout = loadLoadout(browserStorage());
    this.row = 0;
    this.hover = null;
    const screen = h('div');
    screen.append(at(h('div', 't-label', 'Player'), LEFT - 32, TITLE_Y, 'left'), at(h('div', 't-small section', 'loadout'), LEFT - 32, LOADOUT_Y, 'left'));
    this.rows = SLOTS.map((slot) => this.makeRow(screen, slot));
    this.desc = at(h('div', 't-small muted'), OPT_X0 - 12, DESC_Y, 'left');
    this.back = at(h('div', 'opt t-body click'), LEFT, BACK_Y, 'left');
    this.back.append(h('span', 'dot'), h('span', '', 'Back'));
    this.back.addEventListener('mouseenter', () => this.setRow(2));
    this.back.addEventListener('click', () => go(this, 'Menu'));
    screen.append(this.desc, this.back, at(h('div', 't-hint', '↑ ↓ choose    ← → equip    esc back'), VIEW.cx, VIEW.height - 24));
    mountScreen(this, screen);
    this.render();

    const kb = this.input.keyboard!;
    const on = (keys: string[], fn: () => void) => keys.forEach((k) => kb.on(`keydown-${k}`, fn));
    on(['UP', 'W'], () => this.setRow((this.row + 2) % 3, true));
    on(['DOWN', 'S'], () => this.setRow((this.row + 1) % 3, true));
    on(['LEFT', 'A'], () => this.cycle(-1));
    on(['RIGHT', 'D'], () => this.cycle(1));
    on(['ENTER'], () => (this.row === 2 ? go(this, 'Menu') : this.cycle(1)));
    on(['ESC'], () => go(this, 'Menu'));
    (window as unknown as Record<string, unknown>).__player = { scene: this, loadout: () => this.loadout };
  }

  private makeRow(screen: HTMLElement, slot: LoadoutSlot): PickRow {
    const y = ROW_Y[slot];
    const r = SLOTS.indexOf(slot);
    const label = at(h('div', 'lrow-label t-body', slot), LEFT, y, 'left');
    label.classList.add('click');
    label.addEventListener('mouseenter', () => this.setRow(r));
    screen.append(label);
    const opts = SLOT_OPTIONS[slot].map((a, i) => {
      const el = at(h('div', 'lopt t-small click'), OPT_X0 + i * OPT_GAP, y, 'left');
      el.append(h('span', 'dot'), abilityIcon(a.id), h('span', '', a.name), h('span', 'uline'));
      el.addEventListener('mouseenter', () => {
        this.hover = [slot, i];
        this.setRow(r);
        this.render();
      });
      el.addEventListener('mouseleave', () => {
        this.hover = null;
        this.render();
      });
      el.addEventListener('click', () => this.equip(slot, i));
      screen.append(el);
      return el;
    });
    return { slot, label, opts };
  }

  private setRow(r: number, fromKeyboard = false): void {
    if (r === this.row) return;
    this.row = r;
    if (fromKeyboard) this.hover = null;
    this.render();
  }

  private equip(slot: LoadoutSlot, i: number): void {
    const next = pickAndSave(browserStorage(), this.loadout, slot, i);
    if (next !== this.loadout) replay(this.rows[SLOTS.indexOf(slot)]!.opts[i]!, 'pop');
    this.loadout = next;
    this.render();
  }

  private cycle(d: number): void {
    if (this.row === 2) return;
    const slot = SLOTS[this.row]!;
    const next = cycleOption(this.loadout, slot, d);
    const i = SLOT_OPTIONS[slot].findIndex((a) => a.id === next[slot]);
    this.equip(slot, i);
  }

  private render(): void {
    this.rows.forEach((pr, r) => {
      const focus = this.row === r;
      pr.label.classList.toggle('focus', focus);
      SLOT_OPTIONS[pr.slot].forEach((a, i) => {
        pr.opts[i]!.classList.toggle('eq', a.id === this.loadout[pr.slot]);
        pr.opts[i]!.classList.toggle('focus', focus);
      });
    });
    this.back.classList.toggle('sel', this.row === 2);
    // One description line: the hovered option, else the focused row's equipped one (active when on Back).
    const [slot, i] = this.hover ?? [SLOTS[Math.min(this.row, 1)]!, -1];
    const list = SLOT_OPTIONS[slot];
    const a = i >= 0 ? list[i]! : list.find((x) => x.id === this.loadout[slot]) ?? list[list.length - 1]!;
    this.desc.textContent = `${a.name}: ${a.desc}`;
  }
}
