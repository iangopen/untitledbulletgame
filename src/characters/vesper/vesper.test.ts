import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig, type CharacterConfig } from '../config';
import { V_RING, V_SLASH, V_STREAM, V_THROW, Vesper } from './Vesper';
import { knifeForm, vesperConfig, type VesperAttack, type VesperRules } from './vesper.config';
import { registry } from '../registry';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Bullet } from '../../combat/Bullet';
import { bulletPrimitives } from '../../combat/composite';
import { bulletHitsCircle } from '../../combat/hitTest';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { interpBullet } from '../../render/interp';
import { SCREEN_HEIGHT, SCREEN_WIDTH, SOUL_RADIUS } from '../../tuning';
import { theme } from '../../render/theme';

const R = vesperConfig.rules;
const still = { dx: 0, dy: 0, slow: false };
const at = (l: number) => resolveLevel(vesperConfig, l).attacks;

describe('Vesper config', () => {
  it('validates, sits in grid slot 8 with its description', () => {
    expect(validateConfig(vesperConfig)).toEqual([]);
    expect(registry[7]).toMatchObject({ id: 'vesper', shape: 'dagger', maxLevel: 20 });
    expect(vesperConfig.description).toBe('You won’t see her coming. That’s rather the point.');
  });
  it('the validator rejects a broken Vesper config (gap, dropped attack, missing cooldown)', () => {
    const broken = (bands: CharacterConfig<VesperAttack, VesperRules>['bands']) => validateConfig({ ...vesperConfig, bands });
    const [b1, b2, b3] = vesperConfig.bands;
    expect(broken([b1!, { ...b2!, from: 7 }, b3!]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { throw: b3!.attacks.throw, flurry: b3!.attacks.flurry } }]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { ...b3!.attacks, flurry: { ...b3!.attacks.flurry!, cooldown: undefined as never } } }]).length).toBeGreaterThan(0);
  });
  it('unlocks throw at 1, encircle at 6, flurry at 15', () => {
    const ids = (l: number) => Object.keys(at(l)).sort();
    expect(ids(5)).toEqual(['throw']);
    expect(ids(6)).toEqual(['encircle', 'throw']);
    expect(ids(15)).toEqual(['encircle', 'flurry', 'throw']);
  });
  it('difficulty never decreases with level', () => {
    const up = ['damage', 'count', 'speed', 'rings', 'streams', 'slashes'];
    const down = ['cooldown', 'radius', 'pause', 'gap', 'stagger', 'warn'];
    for (const atk of ['throw', 'encircle', 'flurry'] as const) {
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
  it('accent: cool steel, far from every identity color, every projectile color and the soul', () => {
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    const others = [...Object.values(theme.bullet), theme.preActive, theme.soul, ...registry.filter((e) => e.id !== 'vesper').map((e) => e.color)];
    for (const c of others) expect(dist(theme.vesper, c as number), `vs #${(c as number).toString(16)}`).toBeGreaterThan(100);
  });
});

describe('Vesper knife: drawn == hitbox', () => {
  it('blade, tip, guard, handle and pommel are the collision primitives; tip and edge probes', () => {
    const f = knifeForm(R.knifeLength, R.knifeWidth);
    for (const rot of [0, 0.7, 2.4]) {
      const b = new Bullet().init({ shape: 'composite', form: f, a: 0, x: 0, y: 0, rotation: rot, damage: 1, noPop: true });
      const hit: string[] = [], drawn: string[] = [];
      bulletPrimitives(b, (q) => void hit.push(JSON.stringify(q)));
      bulletPrimitives(interpBullet(b, 1, new Bullet()), (q) => void drawn.push(JSON.stringify(q)));
      expect(drawn).toEqual(hit);
      expect(hit.length).toBe(5);
      const c = Math.cos(rot), s = Math.sin(rot);
      const p = (x: number, y: number) => ({ x: c * x - s * y, y: s * x + c * y, r: 0.01 });
      expect(bulletHitsCircle(b, p(R.knifeLength / 2 - 0.3, 0))).toBe(true); // just inside the tip
      expect(bulletHitsCircle(b, p(R.knifeLength / 2 + 0.3, 0))).toBe(false); // just past it
      expect(bulletHitsCircle(b, p(0.1 * R.knifeLength, R.knifeWidth / 2 - 0.2))).toBe(true); // blade edge, inside
      expect(bulletHitsCircle(b, p(0.1 * R.knifeLength, R.knifeWidth / 2 + 0.3))).toBe(false); // beside the blade
    }
  });
});

describe('Vesper encircle', () => {
  it('ring knives are harmless while gold, then hurt', () => {
    const w = new World(640, 369);
    const v = new Vesper(w, 2);
    const p = at(20).encircle!;
    const { knives } = v.ring(p);
    const k = knives[0]!;
    w.soul.pos.x = k.x;
    w.soul.pos.y = k.y;
    let goldHits = 0;
    for (let i = 0; i < Math.round(v.pauseOf(p) / STEP) - 2; i++) {
      const hp = w.soul.hp;
      w.soul.iframes = 0;
      w.step(still, STEP);
      if (w.soul.hp < hp) goldHits++;
    }
    expect(k.armed).toBe(false);
    expect(goldHits).toBe(0);
  });
  it('the gap is always wider than the soul where an escaping soul meets the closing ring (every level, seed, box size)', () => {
    let narrowest = Infinity;
    for (let seed = 1; seed <= 20; seed++) {
      for (const [bw, bh] of [[450, 330], [225, 330], [360, 264]] as const) {
        const w = new World(640, 369);
        w.box.resizeTo(bw, bh, 0);
        w.box.step(STEP);
        const v = new Vesper(w, seed);
        for (let l = 6; l <= 20; l++) {
          v.ring(at(l).encircle!);
          w.pool.clear();
        }
        for (const g of v.ringGaps) {
          expect(g).toBeGreaterThanOrEqual(R.minGap - 1e-9);
          expect(g).toBeGreaterThan(SOUL_RADIUS * 2);
          narrowest = Math.min(narrowest, g);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`encircle: narrowest gap where the soul escapes, 20 seeds x 3 box sizes x L6-20: ${narrowest.toFixed(1)} px (soul diameter ${SOUL_RADIUS * 2})`);
  });
  it('a soul that runs out through the gap when the knives turn white takes no damage; one that stays put is hit', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const move of [true, false]) {
        const w = new World(640, 369);
        const v = new Vesper(w, seed);
        const p = at(20).encircle!;
        w.soul.pos.x = 30;
        w.soul.pos.y = -20;
        const ring = v.ring(p);
        const dir = { dx: Math.round(Math.cos(ring.gapAngle)), dy: Math.round(Math.sin(ring.gapAngle)), slow: false };
        const hp0 = w.soul.hp;
        for (let i = 0; i < 120; i++) {
          // Waits through the gold pause (harmless anyway), then runs straight out through the gap.
          const go = move && ring.knives.some((k) => k.armed);
          w.step(go ? dir : still, STEP);
        }
        if (move) expect(w.soul.hp, `seed ${seed} escaping`).toBe(hp0);
        else expect(w.soul.hp, `seed ${seed} staying`).toBeLessThan(hp0);
      }
    }
  });
  it('the ring stays inside the soul box, also when the soul is in a corner, and the gap way out is clear of the walls', () => {
    const w = new World(640, 369);
    const v = new Vesper(w, 3);
    w.soul.pos.x = w.box.halfWidth - 10;
    w.soul.pos.y = -w.box.halfHeight + 10;
    const { knives, gapAngle, center } = v.ring(at(20).encircle!);
    for (const k of knives) {
      let ok = true;
      bulletPrimitives(k, (q) => {
        const c = q.kind === 'circle' ? q.c : q.kind === 'rect' ? q.r : { x: q.t.cx, y: q.t.cy };
        if (Math.abs(c.x) > w.box.halfWidth || Math.abs(c.y) > w.box.halfHeight) ok = false;
      });
      expect(ok).toBe(true);
    }
    const out = at(20).encircle!.radius! + R.knifeLength;
    expect(Math.abs(center.x + Math.cos(gapAngle) * out)).toBeLessThanOrEqual(w.box.halfWidth);
    expect(Math.abs(center.y + Math.sin(gapAngle) * out)).toBeLessThanOrEqual(w.box.halfHeight);
  });
  it('the pause never drops below the minimum', () => {
    const v = new Vesper(new World(0, 0));
    for (let l = 6; l <= 20; l++) expect(v.pauseOf(at(l).encircle!)).toBeGreaterThanOrEqual(R.minPause);
    expect(v.pauseOf({ ...at(20).encircle!, pause: 0.05 })).toBe(R.minPause);
  });
});

describe('Vesper slashes', () => {
  it('the warning is exactly the slash path (same bullet), never collides, then the slash hurts and is gone', () => {
    const w = new World(640, 369);
    const v = new Vesper(w, 4);
    const p = at(20).flurry!;
    const s = v.slash(p, [0, 0], 0.4)!;
    expect(s).not.toBeNull();
    const path = { x: s.x, y: s.y, r: s.rotation, a: s.a };
    w.soul.pos.x = 0;
    w.soul.pos.y = 0;
    let hurtWhileWarning = 0, hurt = 0;
    const warn = v.warnOf(p);
    for (let i = 0; i < Math.round((warn + R.slashTime) / STEP) + 5; i++) {
      const hp = w.soul.hp;
      w.soul.iframes = 0;
      const armed = s.active && s.armed;
      if (s.active && !s.armed) expect(s.b).toBeCloseTo(R.warnThickness / 2, 9);
      w.step(still, STEP);
      if (w.soul.hp < hp) (armed || s.armed ? hurt++ : hurtWhileWarning++);
      w.soul.hp = w.soul.maxHp;
      if (s.active) expect({ x: s.x, y: s.y, r: s.rotation, a: s.a }).toEqual(path);
    }
    expect(hurtWhileWarning).toBe(0);
    expect(hurt).toBeGreaterThan(0);
    expect(s.active).toBe(false);
  });
  it('the slash warning never drops below the minimum', () => {
    const v = new Vesper(new World(0, 0));
    for (let l = 15; l <= 20; l++) expect(v.warnOf(at(l).flurry!)).toBeGreaterThanOrEqual(R.minWarn);
    expect(v.warnOf({ ...at(20).flurry!, warn: 0.05 })).toBe(R.minWarn);
  });
});

/** Vesper alone `seconds` at `level` (still soul kept alive). */
function measure(level: number, seconds = 40) {
  const w = new World(640, 369);
  const v = new Vesper(w);
  v.setLevel(level);
  const phases: string[] = [];
  w.bus.on('vesperPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started = new Set<string>();
  w.bus.on('attackStarted', (e) => started.add(e.attack));
  const seen = new Map<Bullet, number>();
  const counts = { thrown: 0, ringKnives: 0, streamKnives: 0, slashes: 0 };
  let first = -1, shortestWarn = Infinity, peak = 0, inBand = 0, onScreenSpawn = 0, ringOutside = 0, nonWhite = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    v.tick(STEP);
    for (const b of w.pool.all) {
      if (!b.active) continue;
      const prev = seen.get(b);
      seen.set(b, b.age);
      if (prev !== undefined && b.age >= prev) continue;
      if (b.kind !== 'white') nonWhite++;
      const a = bulletWorldAabb(w.box, b);
      const on = a.x1 > 0 && a.x0 < SCREEN_WIDTH && a.y1 > 0 && a.y0 < SCREEN_HEIGHT;
      if (b.flags & V_THROW) { counts.thrown++; if (on && i > 0) onScreenSpawn++; }
      if (b.flags & V_STREAM) { counts.streamKnives++; if (on) onScreenSpawn++; }
      if (b.flags & V_RING) {
        counts.ringKnives++;
        if (Math.abs(b.x) > w.box.halfWidth || Math.abs(b.y) > w.box.halfHeight) ringOutside++;
      }
      if (b.flags & V_SLASH) { counts.slashes++; shortestWarn = Math.min(shortestWarn, b.armAt); }
      if ((on && aabbInBand(a) && !(b.flags & V_THROW && i === 0))) inBand++;
    }
    w.step(still, STEP);
    w.soul.iframes = 1;
    peak = Math.max(peak, w.pool.activeCount);
    if (first < 0 && w.pool.all.some((b) => b.active && b.armed && (b.flags & V_SLASH ? true : Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight))) first = w.time;
    for (const b of [...seen.keys()]) if (!b.active) seen.delete(b);
  }
  return { phases, counts, first, shortestWarn, peak, inBand, onScreenSpawn, ringOutside, nonWhite, started, gaps: v.ringGaps, dropped: w.pool.dropped, skipped: v.skippedSlashes };
}

describe('Vesper 40 s at levels 1, 10, 20', () => {
  it('timeline, counts, narrowest gap, shortest slash warning, peak bullets, first arrival ~1 s; off-screen spawns, nothing in a band', () => {
    for (const level of [1, 10, 20]) {
      const m = measure(level);
      const gap = m.gaps.length ? Math.min(...m.gaps) : NaN;
      // eslint-disable-next-line no-console
      console.log(`Vesper L${level}: ${m.phases.join(' ')} | first attack reaches the box at ${m.first.toFixed(2)} s | ${JSON.stringify(m.counts)} | rings ${m.gaps.length}, narrowest gap ${Number.isNaN(gap) ? '-' : gap.toFixed(1) + ' px'} (soul ${SOUL_RADIUS * 2}) | shortest slash warning ${Number.isFinite(m.shortestWarn) ? m.shortestWarn.toFixed(3) + ' s' : '-'} | peak bullets ${m.peak} | in a band ${m.inBand}, knives spawned on screen ${m.onScreenSpawn}, ring knives outside the box ${m.ringOutside}, slashes skipped ${m.skipped}, dropped ${m.dropped}`);
      const want = level === 1
        ? ['throw@0.0', 'breather@8.0', 'throw@9.0']
        : level === 10
          ? ['throw@0.0', 'breather@8.0', 'encircle@9.0', 'breather@17.0', 'throw@18.0']
          : ['throw@0.0', 'breather@8.0', 'encircle@9.0', 'breather@17.0', 'flurry@18.0', 'breather@26.0', 'throw@27.0'];
      expect(m.phases.slice(0, want.length)).toEqual(want);
      expect(m.first).toBeGreaterThan(0.85);
      expect(m.first).toBeLessThan(1.15);
      expect(m.inBand + m.onScreenSpawn + m.ringOutside + m.nonWhite + m.dropped + m.skipped).toBe(0);
      expect(m.counts.thrown).toBeGreaterThan(0);
      expect(m.counts.ringKnives > 0).toBe(level >= 6);
      expect(m.counts.streamKnives > 0).toBe(level >= 15);
      if (level >= 6) expect(gap).toBeGreaterThanOrEqual(R.minGap - 1e-9);
      if (level >= 15) expect(m.shortestWarn).toBeGreaterThanOrEqual(R.minWarn - 1e-9);
      expect(m.started).toEqual(new Set(Object.keys(at(level))));
    }
  });
  it('level 0 spawns nothing; level 20 stays bounded for 60 s', () => {
    const w = new World(0, 0);
    const v = new Vesper(w);
    v.setLevel(0);
    for (let i = 0; i < 60 * 20; i++) { v.tick(STEP); w.step(still, STEP); }
    expect(w.pool.activeCount).toBe(0);
    const m = measure(20, 60);
    expect(m.dropped).toBe(0);
    expect(m.peak).toBeLessThan(400);
  });
});
