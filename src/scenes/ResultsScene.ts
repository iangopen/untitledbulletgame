import Phaser from 'phaser';
import { VIEW, space, theme, toCss, type } from '../render/theme';
import type { Outcome } from '../director/Director';
import { registry } from '../characters/registry';
import { totalLevel } from '../director/roster';
import { at, h, replay } from '../ui/dom';
import { enter, go, mountScreen } from './ui';

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

const ACTIONS = ['Retry', 'Roster'] as const;

/** Outcome screen. Retry / Roster are clickable and keyboard-selectable (← →, Enter); R and Esc still work. */
export class ResultsScene extends Phaser.Scene {
  private index = 0;
  private buttons: HTMLElement[] = [];
  private roster: Record<string, number> = {};

  constructor() {
    super('Results');
  }

  create(data: { outcome: Outcome }): void {
    enter(this);
    const o = data.outcome;
    this.roster = { ...o.roster };
    const win = o.result === 'win';
    const screen = h('div');

    // One accent: the result word.
    const title = at(h('div', 't-title', win ? 'Survived' : 'Down'), VIEW.cx, 210);
    title.style.color = toCss(win ? theme.win : theme.loss);
    screen.append(title);
    replay(title, 'pop');

    const active = registry.filter((e) => (this.roster[e.id] ?? 0) > 0);
    const rows: [string, string][] = [
      ['time', formatTime(o.time)],
      ['hp left', `${Math.ceil(o.hp)} / ${o.maxHp}`],
      ...active.map((e): [string, string] => [e.name, String(this.roster[e.id])]),
      ['difficulty', String(totalLevel(this.roster))],
    ];
    const rowH = type.body + space.md;
    rows.forEach(([k, v], i) => {
      const y = 330 + i * rowH;
      screen.append(at(h('div', 't-body dim', k), VIEW.cx - space.md, y, 'right'), at(h('div', 't-body mono', v), VIEW.cx + space.md, y, 'left'));
    });

    this.buttons = ACTIONS.map((label, i) => {
      const b = at(h('div', 'opt t-label click'), VIEW.cx + (i === 0 ? -80 : 80), 600);
      b.append(h('span', 'dot'), h('span', '', label));
      b.addEventListener('mouseenter', () => this.setIndex(i));
      b.addEventListener('click', () => this.act(i));
      screen.append(b);
      return b;
    });
    screen.append(at(h('div', 't-hint', 'r retry    esc roster'), VIEW.cx, VIEW.height - 40));
    mountScreen(this, screen);

    this.index = 0;
    this.render();
    const kb = this.input.keyboard!;
    kb.on('keydown-R', () => this.act(0));
    kb.on('keydown-ESC', () => this.act(1));
    kb.on('keydown-LEFT', () => this.setIndex(0));
    kb.on('keydown-RIGHT', () => this.setIndex(1));
    kb.on('keydown-ENTER', () => this.act(this.index));
    kb.on('keydown-SPACE', () => this.act(this.index));
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__results = { outcome: o, scene: this };
  }

  private setIndex(i: number): void {
    if (i === this.index) return;
    this.index = i;
    this.render();
  }

  private render(): void {
    this.buttons.forEach((b, i) => b.classList.toggle('sel', i === this.index));
  }

  private act(i: number): void {
    go(this, i === 0 ? 'Battle' : 'Roster', { roster: { ...this.roster } });
  }
}
