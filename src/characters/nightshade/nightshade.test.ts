import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig, type CharacterConfig } from '../config';
import { N_POD, N_RING, N_SPORE, N_STRIP, Nightshade } from './Nightshade';
import { nightshadeConfig, podForm, type NightshadeAttack, type NightshadeRules } from './nightshade.config';
import { registry } from '../registry';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Bullet } from '../../combat/Bullet';
import { bulletPrimitives } from '../../combat/composite';
import { bulletHitsCircle } from '../../combat/hitTest';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { interpBullet } from '../../render/interp';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';
import { theme } from '../../render/theme';

const R = nightshadeConfig.rules;
const still = { dx: 0, dy: 0, slow: false };
const at = (l: number) => resolveLevel(nightshadeConfig, l).attacks;

describe('Nightshade config', () => {
  it('validates, sits in grid slot 9 with its description', () => {
    expect(validateConfig(nightshadeConfig)).toEqual([]);
    expect(registry[8]).toMatchObject({ id: 'nightshade', shape: 'berry', maxLevel: 20 });
    expect(nightshadeConfig.description).toBe('Beautiful. Poisonous. Patient.');
  });
  it('the validator rejects a broken Nightshade config (gap, dropped attack, missing cooldown)', () => {
    const broken = (bands: CharacterConfig<NightshadeAttack, NightshadeRules>['bands']) => validateConfig({ ...nightshadeConfig, bands });
    const [b1, b2, b3] = nightshadeConfig.bands;
    expect(broken([b1!, { ...b2!, from: 7 }, b3!]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { spores: b3!.attacks.spores, burst: b3!.attacks.burst } }]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { ...b3!.attacks, burst: { ...b3!.attacks.burst!, cooldown: undefined as never } } }]).length).toBeGreaterThan(0);
  });
  it('unlocks spores at 1, miasma at 6, burst at 15', () => {
    const ids = (l: number) => Object.keys(at(l)).sort();
    expect(ids(5)).toEqual(['spores']);
    expect(ids(6)).toEqual(['miasma', 'spores']);
    expect(ids(15)).toEqual(['burst', 'miasma', 'spores']);
  });
  it('difficulty never decreases with level', () => {
    const up = ['damage', 'count', 'speed', 'linger', 'strips', 'hold', 'ring'];
    const down = ['cooldown', 'spread', 'form'];
    for (const atk of ['spores', 'miasma', 'burst'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = at(l)[atk];
        if (!a) {
          expect(prev, `${atk} dropped at L${l}`).toBeUndefined();
          continue;
        }
        if (prev) {
          for (const k of Object.keys(a)) {
            if (up.includes(k)) expect(a[k]!, `${atk}.${k} at L${l}`).toBeGreaterThanOrEqual(prev[k]!);
            else if (down.includes(k)) expect(a[k]!, `${atk}.${k} at L${l}`).toBeLessThanOrEqual(prev[k]!);
            else throw new Error(`unclassified param ${atk}.${k}`);
          }
        }
        prev = a;
      }
    }
  });
  it('accent: far from every identity color, every projectile color incl. KR, the HP mint, damaging lime and the soul', () => {
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    const others = [...Object.values(theme.bullet), theme.preActive, theme.soul, theme.hpFill, theme.wallDamaging, ...registry.filter((e) => e.id !== 'nightshade').map((e) => e.color)];
    for (const c of others) expect(dist(theme.nightshade, c as number), `vs #${(c as number).toString(16)}`).toBeGreaterThan(100);
  });
});

describe('Nightshade shapes: the edge is the hitbox', () => {
  it('spores are solid discs and strips solid rects: probes just inside hit, just outside miss', () => {
    const s = new Bullet().init({ shape: 'circle', a: R.sporeSize, x: 0, y: 0, damage: 1, kind: 'kr' });
    expect(bulletHitsCircle(s, { x: R.sporeSize - 0.3, y: 0, r: 0.01 })).toBe(true);
    expect(bulletHitsCircle(s, { x: R.sporeSize + 0.3, y: 0, r: 0.01 })).toBe(false);
    const st = new Bullet().init({ shape: 'rect', a: R.stripWidth / 2, b: 165, x: 0, y: 0, damage: 1, kind: 'kr' });
    expect(bulletHitsCircle(st, { x: R.stripWidth / 2 - 0.3, y: 100, r: 0.01 })).toBe(true);
    expect(bulletHitsCircle(st, { x: R.stripWidth / 2 + 0.3, y: 100, r: 0.01 })).toBe(false);
    for (const b of [s, st, new Bullet().init({ shape: 'composite', form: podForm(R.podSize), a: 0, x: 0, y: 0, damage: 1 })]) {
      const hit: string[] = [], drawn: string[] = [];
      bulletPrimitives(b, (q) => void hit.push(JSON.stringify(q)));
      bulletPrimitives(interpBullet(b, 1, new Bullet()), (q) => void drawn.push(JSON.stringify(q)));
      expect(drawn).toEqual(hit);
    }
  });
});

describe('Nightshade rules', () => {
  it('pods are harmless while forming; then they burst into KR rings and are gone', () => {
    const w = new World(640, 369);
    const n = new Nightshade(w, 3);
    const p = at(20).burst!;
    w.soul.pos.x = -200;
    w.soul.pos.y = -150;
    const pods = n.pods(p);
    expect(pods.length).toBeGreaterThan(0);
    // Put the soul right on a pod for the whole forming time.
    const pod = pods[0]!;
    w.soul.pos.x = pod.x;
    w.soul.pos.y = pod.y;
    let hits = 0, rings = 0;
    for (let i = 0; i < Math.round(n.formOf(p) / STEP) - 1; i++) {
      const hp = w.soul.hp, kr = w.soul.kr;
      w.soul.iframes = 0;
      w.step(still, STEP);
      if (w.soul.hp < hp || w.soul.kr > kr) hits++;
    }
    expect(hits).toBe(0);
    for (let i = 0; i < 5; i++) w.step(still, STEP);
    rings = w.pool.all.filter((b) => b.active && b.flags & N_RING).length;
    expect(rings).toBe(pods.length * p.ring!);
    expect(w.pool.all.some((b) => b.active && b.flags & N_POD)).toBe(false);
  });
  it('the forming time never drops below the minimum', () => {
    const n = new Nightshade(new World(0, 0));
    for (let l = 15; l <= 20; l++) expect(n.formOf(at(l).burst!)).toBeGreaterThanOrEqual(R.minForm);
    expect(n.formOf({ ...at(20).burst!, form: 0.05 })).toBe(R.minForm);
  });
  it('miasma always leaves at least minClear of the box clear (every level, wall and box size)', () => {
    let smallest = Infinity;
    for (const [bw, bh] of [[450, 330], [225, 330], [360, 264], [180, 120]] as const) {
      const w = new World(640, 369);
      w.box.resizeTo(bw, bh, 0);
      w.box.step(STEP);
      const n = new Nightshade(w);
      for (let l = 6; l <= 20; l++) {
        for (const wall of ['left', 'right', 'top', 'bottom'] as const) {
          const k = n.stripsFor(at(l).miasma!, wall);
          const clear = n.clearFraction(k, wall);
          expect(clear, `L${l} ${wall} ${bw}x${bh}`).toBeGreaterThanOrEqual(R.minClear - 1e-9);
          smallest = Math.min(smallest, clear);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`miasma: smallest clear fraction over L6-20, 4 walls, 4 box sizes: ${(smallest * 100).toFixed(1)}% (minimum ${R.minClear * 100}%)`);
  });
  it('every Nightshade projectile is KR, and Nightshade alone never takes HP below 1 (still and moving, L20, 60 s)', () => {
    for (const moving of [false, true]) {
      const w = new World(640, 369);
      const n = new Nightshade(w);
      n.setLevel(20);
      let minHp = Infinity, nonKr = 0;
      const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
      for (let i = 0; i < 60 * 60; i++) {
        n.tick(STEP);
        const d = dirs[Math.floor(i / 20) % 8]!;
        w.step(moving ? { dx: d[0], dy: d[1], slow: false } : still, STEP);
        for (const b of w.pool.all) if (b.active && !b.decor && b.kind !== 'kr') nonKr++;
        minHp = Math.min(minHp, w.soul.hp);
      }
      expect(nonKr).toBe(0);
      expect(minHp).toBeGreaterThanOrEqual(1);
      expect(w.soul.alive).toBe(true);
    }
  });
});

/** Nightshade alone `seconds` at `level`; `mode` = 'kept alive' (i-frames held), 'still' or 'moving' (real damage). */
function measure(level: number, mode: 'measure' | 'still' | 'moving', seconds = 40) {
  const w = new World(640, 369);
  const n = new Nightshade(w);
  n.setLevel(level);
  const phases: string[] = [];
  w.bus.on('nightshadePhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started = new Set<string>();
  w.bus.on('attackStarted', (e) => started.add(e.attack));
  const seen = new Map<Bullet, number>();
  const counts = { spores: 0, strips: 0, pods: 0, ringSpores: 0 };
  let first = -1, shortestForm = Infinity, inBand = 0, onScreenSpore = 0, outsideBox = 0, nonKr = 0, peak = 0;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    n.tick(STEP);
    for (const b of w.pool.all) {
      if (!b.active) continue;
      const prev = seen.get(b);
      seen.set(b, b.age);
      if (prev !== undefined && b.age >= prev) continue;
      if (b.kind !== 'kr') nonKr++;
      const a = bulletWorldAabb(w.box, b);
      const on = a.x1 > 0 && a.x0 < SCREEN_WIDTH && a.y1 > 0 && a.y0 < SCREEN_HEIGHT;
      if (on && aabbInBand(a) && !(b.flags & N_SPORE && i === 0)) inBand++;
      if (b.flags & N_SPORE) { counts.spores++; if (on && i > 0) onScreenSpore++; }
      if (b.flags & N_STRIP) { counts.strips++; if (Math.abs(b.x) + b.a > w.box.halfWidth + 1e-6 || Math.abs(b.y) + b.b > w.box.halfHeight + 1e-6) outsideBox++; }
      if (b.flags & N_POD) { counts.pods++; shortestForm = Math.min(shortestForm, b.armAt); if (Math.abs(b.x) > w.box.halfWidth || Math.abs(b.y) > w.box.halfHeight) outsideBox++; }
      if (b.flags & N_RING) counts.ringSpores++;
    }
    const d = dirs[Math.floor(i / 20) % 8]!;
    w.step(mode === 'moving' ? { dx: d[0], dy: d[1], slow: false } : still, STEP);
    if (mode === 'measure') w.soul.iframes = 1;
    peak = Math.max(peak, w.pool.activeCount);
    if (first < 0 && w.pool.all.some((b) => b.active && b.armed && Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight)) first = w.time;
    for (const b of [...seen.keys()]) if (!b.active) seen.delete(b);
  }
  return { phases, counts, first, shortestForm, inBand, onScreenSpore, outsideBox, nonKr, peak, started, clears: n.clears, hp: w.soul.hp, kr: w.soul.kr, dropped: w.pool.dropped };
}

describe('Nightshade 40 s at levels 1, 10, 20', () => {
  it('timeline, counts, smallest clear area, shortest forming, HP still vs moving, first arrival ~1 s', () => {
    for (const level of [1, 10, 20]) {
      const m = measure(level, 'measure');
      const stillRun = measure(level, 'still');
      const moveRun = measure(level, 'moving');
      const clear = m.clears.length ? Math.min(...m.clears) : NaN;
      // eslint-disable-next-line no-console
      console.log(`Nightshade L${level}: ${m.phases.join(' ')} | first attack reaches the box at ${m.first.toFixed(2)} s | ${JSON.stringify(m.counts)} | clouds ${m.clears.length}, smallest clear ${Number.isNaN(clear) ? '-' : (clear * 100).toFixed(1) + '%'} | shortest pod forming ${Number.isFinite(m.shortestForm) ? m.shortestForm.toFixed(3) + ' s' : '-'} | peak bullets ${m.peak} | HP after 40 s: still ${stillRun.hp.toFixed(1)} (KR ${stillRun.kr.toFixed(1)}), moving ${moveRun.hp.toFixed(1)} (KR ${moveRun.kr.toFixed(1)}) | in a band ${m.inBand}, spores spawned on screen ${m.onScreenSpore}, strips/pods outside the box ${m.outsideBox}`);
      const want = level === 1
        ? ['spores@0.0', 'breather@8.0', 'spores@9.0']
        : level === 10
          ? ['spores@0.0', 'breather@8.0', 'miasma@9.0', 'breather@17.0', 'spores@18.0']
          : ['spores@0.0', 'breather@8.0', 'miasma@9.0', 'breather@17.0', 'burst@18.0', 'breather@26.0', 'spores@27.0'];
      expect(m.phases.slice(0, want.length)).toEqual(want);
      expect(m.first).toBeGreaterThan(0.85);
      expect(m.first).toBeLessThan(1.15);
      expect(m.inBand + m.onScreenSpore + m.outsideBox + m.nonKr + m.dropped).toBe(0);
      expect(m.counts.spores).toBeGreaterThan(0);
      expect(m.counts.strips > 0).toBe(level >= 6);
      expect(m.counts.pods > 0).toBe(level >= 15);
      if (level >= 6) expect(clear).toBeGreaterThanOrEqual(R.minClear - 1e-9);
      if (level >= 15) expect(m.shortestForm).toBeGreaterThanOrEqual(R.minForm - 1e-9);
      for (const r of [stillRun, moveRun]) expect(r.hp).toBeGreaterThanOrEqual(1);
      expect(m.started).toEqual(new Set(Object.keys(at(level))));
    }
  });
  it('level 0 spawns nothing', () => {
    const w = new World(0, 0);
    const n = new Nightshade(w);
    n.setLevel(0);
    for (let i = 0; i < 60 * 20; i++) { n.tick(STEP); w.step(still, STEP); }
    expect(w.pool.activeCount).toBe(0);
  });
});
