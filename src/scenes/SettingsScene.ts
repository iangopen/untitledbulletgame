import Phaser from 'phaser';
import { VIEW } from '../render/theme';
import { at, h, replay } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { settings } from '../settings/store';
import { QUALITIES, type Quality } from '../settings/settings';
import { capOptions, formatFps } from '../settings/refresh';
import { frameLimiter } from '../render/frameLimiter';

export interface SettingsData {
  /** Where Back returns to: the menu (scene switch) or a paused battle (resumed underneath). */
  from?: 'Menu' | 'Battle';
}

interface ChoiceRow {
  kind: 'choice';
  label: string;
  value(): string;
  /** Step the value by -1 or +1 (wrapping). */
  step(d: number): void;
  mono?: boolean;
}
interface ActionRow {
  kind: 'action';
  label: string;
  run(): void;
}
type Row = ChoiceRow | ActionRow;

const QUALITY_LABEL: Record<Quality, string> = { full: 'full', balanced: 'balanced', performance: 'performance' };
const onOff = (v: boolean) => (v ? 'on' : 'off');
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Settings screen (HTML layer). Settings only change how and how often the game is drawn, never
 * the simulation. Every change applies live and is saved immediately (settings/store.ts).
 * One selection index is shared by keyboard and hover; ←/→ or the ‹ › arrows change a value,
 * clicking a row steps it forward, Enter steps or activates.
 */
export class SettingsScene extends Phaser.Scene {
  private from: 'Menu' | 'Battle' = 'Menu';
  private index = 0;
  private rows: Row[] = [];
  private els: HTMLElement[] = [];
  private valueEls: (HTMLElement | null)[] = [];
  private infoEl!: HTMLElement;
  private leaving = false;

  constructor() {
    super('Settings');
  }

  create(data: SettingsData = {}): void {
    enter(this);
    this.from = data.from ?? 'Menu';
    this.index = 0;
    this.leaving = false;
    this.rows = this.buildRows();

    const { cx } = VIEW;
    const screen = h('div');
    screen.append(at(h('div', 't-title', 'Settings'), cx, 140));
    let y = 240;
    this.els = [];
    this.valueEls = [];
    this.rows.forEach((row, i) => {
      if (row.kind === 'action' && this.rows[i - 1]?.kind === 'choice') y += 28; // gap before actions
      const el = row.kind === 'choice' ? at(h('div', 'opt t-body click srow'), cx, y) : at(h('div', 'opt t-body click'), cx, y);
      el.append(h('span', 'dot'), h('span', '', row.label));
      let valueEl: HTMLElement | null = null;
      if (row.kind === 'choice') {
        const val = h('span', 'val');
        const prev = h('span', 'arrow click', '‹');
        const next = h('span', 'arrow click', '›');
        valueEl = h('span', 'v');
        prev.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setIndex(i);
          this.change(-1);
        });
        next.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setIndex(i);
          this.change(1);
        });
        val.append(prev, valueEl, next);
        el.append(val);
      }
      el.addEventListener('mouseenter', () => this.setIndex(i));
      el.addEventListener('click', () => {
        this.setIndex(i);
        this.activate();
      });
      screen.append(el);
      this.els.push(el);
      this.valueEls.push(valueEl);
      y += 52;
    });
    this.infoEl = at(h('div', 't-hint mono'), cx, VIEW.height - 84);
    screen.append(this.infoEl, at(h('div', 't-hint', '↑ ↓ choose    ← → change    enter select    esc back'), cx, VIEW.height - 40));
    mountScreen(this, screen);
    this.render();

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-W', () => this.move(-1));
    kb.on('keydown-S', () => this.move(1));
    kb.on('keydown-LEFT', () => this.change(-1));
    kb.on('keydown-RIGHT', () => this.change(1));
    kb.on('keydown-A', () => this.change(-1));
    kb.on('keydown-D', () => this.change(1));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-SPACE', () => this.activate());
    kb.on('keydown-ESC', () => this.back());
    kb.on('keydown-BACKSPACE', () => this.back());
    // The measured refresh rate and canvas size can change while open (new screen, quality).
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.render() });
  }

  private buildRows(): Row[] {
    const caps = () => capOptions(frameLimiter.hz);
    return [
      {
        kind: 'choice',
        label: 'Frame rate limit',
        mono: true,
        value: () => {
          const d = frameLimiter.divisor;
          return d === 1 ? 'match display' : `${formatFps(frameLimiter.hz / d)} fps`;
        },
        step: (dir) => {
          const opts = caps();
          const cur = Math.max(0, opts.findIndex((o) => o.divisor === frameLimiter.divisor));
          settings.set({ frameDivisor: opts[wrap(cur + dir, opts.length)]!.divisor });
        },
      },
      {
        kind: 'choice',
        label: 'Render quality',
        value: () => QUALITY_LABEL[settings.current.quality],
        step: (dir) => {
          const i = QUALITIES.indexOf(settings.current.quality);
          settings.set({ quality: QUALITIES[wrap(i + dir, QUALITIES.length)]! });
        },
      },
      { kind: 'choice', label: 'Show FPS', value: () => onOff(settings.current.showFps), step: () => settings.set({ showFps: !settings.current.showFps }) },
      { kind: 'choice', label: 'Screen shake', value: () => onOff(settings.current.shake), step: () => settings.set({ shake: !settings.current.shake }) },
      { kind: 'choice', label: 'Hit flash', value: () => onOff(settings.current.flash), step: () => settings.set({ flash: !settings.current.flash }) },
      { kind: 'action', label: 'Reset to defaults', run: () => settings.reset() },
      { kind: 'action', label: 'Back', run: () => this.back() },
    ];
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.render();
  }

  private move(d: number): void {
    this.index = wrap(this.index + d, this.rows.length);
    this.render();
    replay(this.els[this.index]!, 'pop');
  }

  /** ←/→: change a value; does nothing on action rows. */
  private change(d: number): void {
    const row = this.rows[this.index]!;
    if (row.kind !== 'choice') return;
    row.step(d);
    this.render();
    replay(this.valueEls[this.index]!, 'pop');
  }

  /** Enter / click: step a value forward, or run an action. */
  private activate(): void {
    const row = this.rows[this.index]!;
    if (row.kind === 'choice') {
      this.change(1);
      return;
    }
    row.run();
    if (!this.leaving) {
      this.render();
      replay(this.els[this.index]!, 'pop');
    }
  }

  private render(): void {
    this.els.forEach((el, i) => el.classList.toggle('sel', i === this.index));
    this.rows.forEach((row, i) => {
      const v = this.valueEls[i];
      if (row.kind !== 'choice' || !v) return;
      const text = row.value();
      v.textContent = text;
      // Mono is for numbers only ("72 fps"), not words ("match display").
      v.classList.toggle('mono', !!row.mono && /\d/.test(text));
    });
    const c = this.game.canvas;
    const hz = frameLimiter.measured ? `display ${frameLimiter.hz} Hz` : 'display measuring';
    this.infoEl.textContent = `${hz}    canvas ${c.width} × ${c.height}`;
  }

  private back(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (this.from === 'Battle') {
      // The battle is paused underneath; resume the scene (its own pause menu stays open).
      this.scene.resume('Battle');
      this.scene.stop();
    } else {
      go(this, 'Menu');
    }
  }
}
