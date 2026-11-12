import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig, type CharacterConfig } from '../config';
import { VOLT_BOLT, VOLT_BRANCH, VOLT_STORM, VOLT_WARN, Volt } from './Volt';
import { boltForm, columnWidth, voltConfig, type VoltAttack, type VoltRules } from './volt.config';
import { registry } from '../registry';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Bullet } from '../../combat/Bullet';
import { bulletPrimitives } from '../../combat/composite';
import { bulletHitsCircle } from '../../combat/hitTest';
import { rectCorners } from '../../combat/Bullet';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { interpBullet } from '../../render/interp';
import { SCREEN_HEIGHT, SCREEN_WIDTH, SOUL_RADIUS } from '../../tuning';
import { theme } from '../../render/theme';

const R = voltConfig.rules;
const still = { dx: 0, dy: 0, slow: false };
const at = (l: number) => resolveLevel(voltConfig, l).attacks;

describe('Volt config', () => {
  it('validates, sits in grid slot 7 with its description', () => {
    expect(validateConfig(voltConfig)).toEqual([]);
    expect(registry[6]).toMatchObject({ id: 'volt', shape: 'bolt', maxLevel: 20 });
    expect(voltConfig.description).toBe('He never strikes the same place twice. He doesn’t need to.');
  });
  it('the validator rejects a broken Volt config (gap, dropped attack, missing cooldown)', () => {
    const broken = (bands: CharacterConfig<VoltAttack, VoltRules>['bands']) => validateConfig({ ...voltConfig, bands });
    const [b1, b2, b3] = voltConfig.bands;
    expect(broken([b1!, { ...b2!, from: 7 }, b3!]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { strike: b3!.attacks.strike, storm: b3!.attacks.storm } }]).length).toBeGreaterThan(0);
    expect(broken([b1!, b2!, { ...b3!, attacks: { ...b3!.attacks, storm: { ...b3!.attacks.storm!, cooldown: undefined as never } } }]).length).toBeGreaterThan(0);
  });
  it('unlocks strike at 1, fork at 6, storm at 15', () => {
    const ids = (l: number) => Object.keys(at(l)).sort();
    expect(ids(1)).toEqual(['strike']);
    expect(ids(5)).toEqual(['strike']);
    expect(ids(6)).toEqual(['fork', 'strike']);
    expect(ids(15)).toEqual(['fork', 'storm', 'strike']);
  });
  it('difficulty never decreases with level', () => {
    const up = ['damage', 'count', 'burst', 'branches', 'waves'];
    const down = ['cooldown', 'warn', 'gap', 'flash', 'stagger', 'interval', 'safe'];
    for (const atk of ['strike', 'fork', 'storm'] as const) {
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
  it('accent: electric violet, far from every projectile color, the soul, gold, peach, Prism, Rose', () => {
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    for (const c of [...Object.values(theme.bullet), theme.preActive, theme.soul, theme.ulysses, theme.ember, theme.prism, theme.rose, theme.hpFill]) {
      expect(dist(theme.volt, c as number)).toBeGreaterThan(100);
    }
  });
});

describe('Volt bolts: drawn == hitbox, inside the warned column', () => {
  it('every variant of both bolt lengths keeps every solid part inside its column; drawn primitives == collision primitives', () => {
    const cw = columnWidth(R);
    for (const len of [R.boltLength, R.branchLength]) {
      for (let v = 0; v < R.variants; v++) {
        const f = boltForm(len, R.boltCore, R.boltJag, R.boltPieces, v);
        const b = new Bullet().init({ shape: 'composite', form: f, a: 0, x: 0, y: 0, damage: 1, noPop: true });
        let maxOff = 0;
        bulletPrimitives(b, (q) => {
          if (q.kind === 'rect') for (const c of rectCorners(q.r, [0, 1, 2, 3].map(() => ({ x: 0, y: 0 })))) maxOff = Math.max(maxOff, Math.abs(c.y));
        });
        expect(maxOff).toBeLessThanOrEqual(cw / 2 + 1e-9);
        const hit: string[] = [], drawn: string[] = [];
        bulletPrimitives(b, (q) => void hit.push(JSON.stringify(q)));
        bulletPrimitives(interpBullet(b, 1, new Bullet()), (q) => void drawn.push(JSON.stringify(q)));
        expect(drawn).toEqual(hit);
        // The core is solid along the bolt (a probe on the line at every 10 px hits) and nothing beyond the column does.
        for (let x = 2; x < len - 2; x += 10) {
          let any = false;
          for (let y = -cw / 2; y <= cw / 2 && !any; y += 0.5) any = bulletHitsCircle(b, { x, y, r: 0.01 });
          expect(any, `solid at x ${x}`).toBe(true);
          expect(bulletHitsCircle(b, { x, y: cw / 2 + 0.3, r: 0.01 })).toBe(false);
          expect(bulletHitsCircle(b, { x, y: -cw / 2 - 0.3, r: 0.01 })).toBe(false);
        }
      }
    }
  });
});

describe('Volt warnings', () => {
  it('a bolt never collides during its warning; it hurts only once it strikes; then it is gone', () => {
    const w = new World(640, 369);
    const v = new Volt(w, 3);
    const p = at(20).strike!;
    v.strike(p, [0]);
    w.soul.pos.x = 0;
    w.soul.pos.y = 0;
    let hurtDuringWarn = 0, hurt = 0, warnSteps = 0;
    for (let i = 0; i < 90; i++) {
      const hp = w.soul.hp;
      w.soul.iframes = 0;
      w.step(still, STEP);
      const warning = w.pool.all.some((b) => b.active && b.flags & VOLT_WARN);
      const bolt = w.pool.all.find((b) => b.active && b.flags & VOLT_BOLT);
      const boltIn = bolt && bolt.y + R.boltLength >= -w.box.halfHeight;
      if (warning && !boltIn) warnSteps++;
      if (w.soul.hp < hp) (boltIn ? hurt++ : hurtDuringWarn++);
      w.soul.hp = w.soul.maxHp;
    }
    expect(warnSteps * STEP).toBeGreaterThanOrEqual(v.warnOf(p) - STEP);
    expect(hurtDuringWarn).toBe(0);
    expect(hurt).toBeGreaterThan(0);
    expect(w.pool.all.some((b) => b.active && !b.decor)).toBe(false);
  });
  it('fork branches are harmless while they flash and hurt once armed', () => {
    const w = new World(640, 369);
    const v = new Volt(w, 5);
    const p = at(20).fork!;
    v.fork(p, -150);
    let branchHurtWhileGold = 0, branches = 0, armed = 0;
    for (let i = 0; i < 150; i++) {
      w.step(still, STEP);
      for (const b of w.pool.all) {
        if (!b.active || !(b.flags & VOLT_BRANCH)) continue;
        branches++;
        if (b.armed) armed++;
        // Put a probe soul on the branch's line: while gold it must not count as a hit.
        const c = { x: b.x + Math.cos(b.rotation) * 60, y: b.y + Math.sin(b.rotation) * 60, r: 12 };
        if (!b.armed && bulletHitsCircle(b, c) && b.armed) branchHurtWhileGold++;
      }
    }
    expect(branches).toBeGreaterThan(0);
    expect(armed).toBeGreaterThan(0);
    expect(branchHurtWhileGold).toBe(0);
  });
  it('the minimum warning holds at every level and even if tuned below it', () => {
    const v = new Volt(new World(0, 0));
    expect(R.minWarn).toBe(0.3);
    for (let l = 1; l <= 20; l++) {
      for (const atk of ['strike', 'fork', 'storm'] as const) {
        const p = at(l)[atk];
        if (p) expect(v.warnOf(p)).toBeGreaterThanOrEqual(R.minWarn);
      }
      const f = at(l).fork;
      if (f) expect(v.flashOf(f)).toBeGreaterThanOrEqual(R.minWarn);
    }
    expect(v.warnOf({ ...at(20).strike!, warn: 0.05 })).toBe(R.minWarn);
    expect(v.flashOf({ ...at(20).fork!, flash: 0.01 })).toBe(R.minWarn);
  });
});

describe('Volt storm', () => {
  it('every wave leaves safe columns at least max(safe, stormSafeMin) wide (> soul diameter), at every level, seed and box width', () => {
    let narrowest = Infinity;
    for (let seed = 1; seed <= 25; seed++) {
      for (const width of [450, 225, 300]) {
        const w = new World(640, 369);
        w.box.resizeTo(width, w.box.height, 0);
        w.box.step(STEP);
        const v = new Volt(w, seed);
        for (let l = 15; l <= 20; l++) {
          const p = at(l).storm!;
          for (let k = 0; k < 6; k++) {
            const gaps = v.stormWave(p);
            expect(gaps.length).toBeGreaterThanOrEqual(1);
            for (const [a, b] of gaps) {
              expect(b - a).toBeGreaterThanOrEqual(Math.max(p.safe!, R.stormSafeMin) - 1e-9);
              expect(b - a).toBeGreaterThan(SOUL_RADIUS * 2);
              narrowest = Math.min(narrowest, b - a);
            }
            w.pool.clear();
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`storm: narrowest safe column over 25 seeds x 3 box widths x L15-20: ${narrowest.toFixed(1)} px (soul diameter ${SOUL_RADIUS * 2})`);
  });
});

/** Volt alone `seconds` at `level` (still soul kept alive). */
function measure(level: number, seconds = 40) {
  const w = new World(640, 369);
  const v = new Volt(w);
  v.setLevel(level);
  const phases: string[] = [];
  w.bus.on('voltPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started = new Set<string>();
  w.bus.on('attackStarted', (e) => started.add(e.attack));
  const seen = new Set<Bullet>();
  const entered = new Set<Bullet>();
  const counts = { warnings: 0, strikeBolts: 0, forkBolts: 0, branches: 0, stormBolts: 0 };
  let first = -1, shortestWarn = Infinity, inBand = 0, warnOutside = 0, onScreenBolt = 0, nonWhite = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    v.tick(STEP);
    w.step(still, STEP);
    w.soul.iframes = 1;
    for (const b of w.pool.all) {
      if (!b.active) continue;
      if (!seen.has(b)) {
        seen.add(b);
        if (b.kind !== 'white') nonWhite++;
        if (b.flags & VOLT_WARN) {
          counts.warnings++;
          if (Math.abs(b.x) + b.a > w.box.halfWidth + 1e-6 || b.b > w.box.halfHeight + 1e-6) warnOutside++;
        } else if (b.flags & VOLT_BRANCH) {
          counts.branches++;
          shortestWarn = Math.min(shortestWarn, b.armAt);
        } else if (b.flags & VOLT_STORM) counts.stormBolts++;
        else if (b.flags & VOLT_BOLT) {
          if (v.phaseAt(w.time).next === 'fork') counts.forkBolts++;
          else counts.strikeBolts++;
        }
        const a = bulletWorldAabb(w.box, b);
        if (!b.armed && aabbInBand(a)) inBand++;
        // Bolts start fully above the screen (spawned during this step's update, already moved once).
        if (b.flags & (VOLT_BOLT | VOLT_STORM) && a.y1 > b.vy * STEP + 1e-6 && a.y1 > 0 && a.y0 < SCREEN_HEIGHT && a.x1 > 0 && a.x0 < SCREEN_WIDTH) onScreenBolt++;
      }
      // A bolt reaches the box when its tip passes the top wall; the warning it struck through has been up this long.
      if (b.flags & (VOLT_BOLT | VOLT_STORM) && !entered.has(b) && b.y + R.boltLength >= -w.box.halfHeight) {
        entered.add(b);
        if (first < 0) first = w.time;
        // The warning this bolt struck through is the oldest one in its column (a newer one may be up for the next strike).
        const warn = w.pool.all.filter((o) => o.active && o.flags & VOLT_WARN && Math.abs(o.x - b.x) < 0.5).sort((p, q) => q.age - p.age)[0];
        if (warn) shortestWarn = Math.min(shortestWarn, warn.age);
      }
    }
    for (const b of [...seen]) if (!b.active) { seen.delete(b); entered.delete(b); }
  }
  return { phases, counts, first, shortestWarn, inBand, warnOutside, onScreenBolt, nonWhite, started, safe: v.stormSafe, dropped: w.pool.dropped };
}

describe('Volt 40 s at levels 1, 10, 20', () => {
  it('timeline, counts, shortest warning, narrowest storm safe column, first arrival ~1 s; warnings inside the box; bolts start off screen', () => {
    for (const level of [1, 10, 20]) {
      const m = measure(level);
      const safe = m.safe.length ? Math.min(...m.safe) : NaN;
      // eslint-disable-next-line no-console
      console.log(`Volt L${level}: ${m.phases.join(' ')} | first bolt reaches the box at ${m.first.toFixed(2)} s | ${JSON.stringify(m.counts)} | shortest warning ${m.shortestWarn.toFixed(3)} s | storm waves ${m.safe.length}, narrowest safe column ${Number.isNaN(safe) ? '-' : safe.toFixed(1) + ' px'} (soul ${SOUL_RADIUS * 2} px) | gold in a band ${m.inBand}, warnings outside the box ${m.warnOutside}, bolts spawned on screen ${m.onScreenBolt}`);
      const want = level === 1
        ? ['strike@0.0', 'breather@8.0', 'strike@9.0']
        : level === 10
          ? ['strike@0.0', 'breather@8.0', 'fork@9.0', 'breather@17.0', 'strike@18.0']
          : ['strike@0.0', 'breather@8.0', 'fork@9.0', 'breather@17.0', 'storm@18.0', 'breather@26.0', 'strike@27.0'];
      expect(m.phases.slice(0, want.length)).toEqual(want);
      expect(m.first).toBeGreaterThan(0.85);
      expect(m.first).toBeLessThan(1.15);
      expect(m.shortestWarn).toBeGreaterThanOrEqual(R.minWarn - STEP);
      expect(m.inBand + m.warnOutside + m.onScreenBolt + m.nonWhite + m.dropped).toBe(0);
      expect(m.counts.strikeBolts).toBeGreaterThan(0);
      expect(m.counts.branches > 0).toBe(level >= 6);
      expect(m.counts.stormBolts > 0).toBe(level >= 15);
      if (level >= 15) expect(safe).toBeGreaterThanOrEqual(R.stormSafeMin - 1e-9);
      expect(m.started).toEqual(new Set(Object.keys(at(level))));
    }
  });
  it('level 0 spawns nothing; level 20 stays bounded for 60 s', () => {
    const w = new World(0, 0);
    const v = new Volt(w);
    v.setLevel(0);
    for (let i = 0; i < 60 * 20; i++) { v.tick(STEP); w.step(still, STEP); }
    expect(w.pool.activeCount).toBe(0);
    expect(measure(20, 60).dropped).toBe(0);
  });
});
