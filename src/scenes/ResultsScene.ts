import Phaser from 'phaser';
import { theme } from '../render/theme';
import type { Outcome } from '../director/Director';
import { registry } from '../characters/registry';
import { totalLevel } from '../director/roster';
import { drawShape, enter, go, label, pop } from './ui';

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
    const { width } = this.scale;
    const win = o.result === 'win';
    const color = win ? theme.win : theme.loss;

    const g = this.add.graphics();
    drawShape(g, 'circle', width / 2, 92, 12, theme.soul);
    const title = label(this, width / 2, 140, win ? 'SURVIVED' : 'DOWN', { size: 40, bold: true, color });
    pop(this, title, 1.3);

    const rows: [string, string][] = [
      ['TIME SURVIVED', formatTime(o.time)],
      ['HP LEFT', `${Math.ceil(o.hp)} / ${o.maxHp}`],
      ...registry.map((e): [string, string] => [e.name.toUpperCase(), `LV ${roster[e.id] ?? 0}`]),
      ['TOTAL DIFFICULTY', String(totalLevel(roster))],
    ];
    rows.forEach(([k, v], i) => {
      const y = 210 + i * 28;
      label(this, width / 2 - 20, y, k, { size: 13, color: theme.textDim, align: 'right' });
      label(this, width / 2 + 20, y, v, { size: 16, bold: true, mono: true, align: 'left' });
    });

    label(this, width / 2, 430, 'R / ENTER retry   ESC roster', { size: 12, mono: true, color: theme.textDim });
    const kb = this.input.keyboard!;
    const retry = () => go(this, 'Battle', { roster: { ...roster } });
    kb.on('keydown-R', retry);
    kb.on('keydown-ENTER', retry);
    kb.on('keydown-ESC', () => go(this, 'Roster', { roster: { ...roster } }));
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__results = { outcome: o };
  }
}
