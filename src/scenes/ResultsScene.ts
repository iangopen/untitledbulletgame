import Phaser from 'phaser';
import { VIEW, space, theme, type } from '../render/theme';
import type { Outcome } from '../director/Director';
import { registry } from '../characters/registry';
import { totalLevel } from '../director/roster';
import { enter, go, hint, label, pop } from './ui';

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(data: { outcome: Outcome }): void {
    enter(this);
    const o = data.outcome;
    const roster = { ...o.roster };
    const win = o.result === 'win';

    // One accent: the result word.
    const title = label(this, VIEW.cx, 210, win ? 'Survived' : 'Down', { size: type.title, weight: 600, color: win ? theme.win : theme.loss });
    pop(this, title, 1.12);

    const active = registry.filter((e) => (roster[e.id] ?? 0) > 0);
    const rows: [string, string][] = [
      ['time', formatTime(o.time)],
      ['hp left', `${Math.ceil(o.hp)} / ${o.maxHp}`],
      ...active.map((e): [string, string] => [e.name, String(roster[e.id])]),
      ['difficulty', String(totalLevel(roster))],
    ];
    const rowH = type.body + space.md;
    const y0 = 330;
    rows.forEach(([k, v], i) => {
      const y = y0 + i * rowH;
      label(this, VIEW.cx - space.md, y, k, { size: type.body, color: theme.textDim, align: 'right' });
      label(this, VIEW.cx + space.md, y, v, { size: type.body, mono: true, align: 'left' });
    });

    hint(this, 'r retry    esc roster');
    const kb = this.input.keyboard!;
    const retry = () => go(this, 'Battle', { roster: { ...roster } });
    kb.on('keydown-R', retry);
    kb.on('keydown-ENTER', retry);
    kb.on('keydown-ESC', () => go(this, 'Roster', { roster: { ...roster } }));
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__results = { outcome: o };
  }
}
