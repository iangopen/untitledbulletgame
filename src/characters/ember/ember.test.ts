import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { emberConfig, flameWallForm } from './ember.config';
import { Ember } from './Ember';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Bullet as B, type Bullet } from '../../combat/Bullet';
import { bulletHitsCircle } from '../../combat/hitTest';
import { bulletPrimitives, ringTongue } from '../../combat/composite';
import { interpBullet } from '../../render/interp';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';
import { registry } from '../registry';
import { theme } from '../../render/theme';

const STILL = { dx: 0, dy: 0, slow: false };
const attacksAt = (l: number) => Object.keys(resolveLevel(emberConfig, l).attacks).sort();

describe('Ember config', () => {
  it('validates, and is registered as slot 6 with the flame shape', () => {
    expect(validateConfig(emberConfig)).toEqual([]);
    expect(registry[5]).toMatchObject({ id: 'ember', shape: 'flame', maxLevel: 20 });
    expect(registry.length).toBe(8);
  });
  it('embers 1-20; sweep joins at 6; wildfire at 15', () => {
    for (const l of [1, 5]) expect(attacksAt(l)).toEqual(['embers']);
    for (const l of [6, 14]) expect(attacksAt(l)).toEqual(['embers', 'sweep']);
    for (const l of [15, 20]) expect(attacksAt(l)).toEqual(['embers', 'sweep', 'wildfire']);
  });
  it('resolves band edges and midpoints (counts are integers)', () => {
    expect(resolveLevel(emberConfig, 1).attacks.embers).toMatchObject({ cooldown: 1.1, count: 4 });
    expect(resolveLevel(emberConfig, 10).attacks.sweep!.cooldown).toBeCloseTo(3.4 + (2.6 - 3.4) * (4 / 8));
    expect(resolveLevel(emberConfig, 20).attacks.wildfire).toMatchObject({ cooldown: 2.0, count: 2 });
    for (let l = 1; l <= 20; l++) for (const a of Object.values(resolveLevel(emberConfig, l).attacks)) expect(Number.isInteger(a!.count)).toBe(true);
  });
  it('difficulty never decreases with level, per parameter', () => {
    const up = ['damage', 'speed', 'count', 'drift', 'size', 'cover', 'thickness'];
    for (const atk of ['embers', 'sweep', 'wildfire'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(emberConfig, l).attacks[atk];
        if (!a) continue;
        if (prev) {
          for (const k of Object.keys(a)) {
            if (k === 'cooldown') expect(a[k]!, `${atk}.${k} L${l}`).toBeLessThanOrEqual(prev[k]!);
            else if (up.includes(k)) expect(a[k]!, `${atk}.${k} L${l}`).toBeGreaterThanOrEqual(prev[k]!);
            else throw new Error(`unclassified ${atk}.${k}`);
          }
        }
        prev = a;
      }
    }
  });
  it('the validator rejects a broken Ember config (gap in levels, missing lower attack, no cooldown)', () => {
    const [b1, b2, b3] = emberConfig.bands;
    expect(validateConfig({ ...emberConfig, bands: [b1!, b3!] }).length).toBeGreaterThan(0);
    const { embers: _e, ...noEmbers } = b2!.attacks;
    expect(validateConfig({ ...emberConfig, bands: [b1!, { ...b2!, attacks: noEmbers }, b3!] }).length).toBeGreaterThan(0);
    const { cooldown: _c, ...noCd } = b1!.attacks.embers!;
    expect(validateConfig({ ...emberConfig, bands: [{ ...b1!, attacks: { embers: noCd } }, b2!, b3!] }).length).toBeGreaterThan(0);
  });
  it('accent: a warm flame color clearly apart from gold, golem orange, the soul red and orange projectiles', () => {
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    for (const c of [theme.ulysses, theme.warden, theme.soul, theme.bullet.orange]) expect(dist(theme.ember, c)).toBeGreaterThan(100);
  });
});

const kindOf = (b: Bullet) => (b.decor ? 'icon' : b.shape === 'ring' ? 'wildfire' : b.form?.parts.length === 4 ? 'embers' : 'sweep');

/** Run Ember alone for `seconds`, tracking spawns and arrivals. */
function runEmber(level: number, seconds: number, mover: boolean) {
  const w = new World(640, 369);
  const e = new Ember(w, 5);
  e.setLevel(level);
  const phases: string[] = [];
  w.bus.on('emberPhaseChanged', (ev) => phases.push(`${ev.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started = new Set<string>();
  w.bus.on('attackStarted', (ev) => started.add(ev.attack));
  const seen = new Set<Bullet>();
  const entered = new Set<Bullet>();
  const counts: Record<string, number> = {};
  const spawned: Record<string, number> = {};
  let icons = 0, iconBad = 0;
  let onScreenSpawns = 0, notOrange = 0, wrongPhase = 0, ringBad = 0, inBand = 0;
  let dir = 1, lost = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    e.tick(STEP);
    for (const b of w.pool.all) {
      if (!b.active || seen.has(b)) continue;
      seen.add(b);
      const k = kindOf(b);
      if (k === 'icon') {
        // The warning icon: harmless decor at the ring's center, outside the box, never in a band.
        icons++;
        if ((Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight) || aabbInBand(bulletWorldAabb(w.box, b))) iconBad++;
        continue;
      }
      spawned[k] = (spawned[k] ?? 0) + 1;
      if (b.kind !== 'orange') notOrange++;
      if (aabbInBand(bulletWorldAabb(w.box, b))) inBand++;
      const p = w.box.toWorld(b);
      if (k === 'wildfire') {
        // Rings form just outside the box (outside every wall, never inside).
        if (Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight) ringBad++;
      } else if (p.x >= 0 && p.x <= SCREEN_WIDTH && p.y >= 0 && p.y <= SCREEN_HEIGHT) onScreenSpawns++;
    }
    // A constant mover: sweeps left and right, never stopping (holding into a wall still counts).
    if (Math.abs(w.soul.pos.x) > w.box.halfWidth - 20) dir = -Math.sign(w.soul.pos.x);
    const hp0 = w.soul.hp;
    w.step(mover ? { dx: dir, dy: 0, slow: false } : STILL, STEP);
    lost += Math.max(0, hp0 - w.soul.hp);
    for (const b of w.pool.all) {
      if (!b.active || entered.has(b) || b.decor) continue;
      const k = kindOf(b);
      const arrived = k === 'wildfire' ? b.a + b.b / 2 >= emberConfig.rules.ringGap : k === 'embers' ? b.y < w.box.halfHeight : Math.abs(b.x) <= w.box.halfWidth + 1;
      if (!arrived) continue;
      entered.add(b);
      counts[k] = (counts[k] ?? 0) + 1;
      // Within two steps (an arrival is measured on the step it crosses the line).
      if (![-2 * STEP, -STEP, 0, STEP, 2 * STEP].some((d) => e.phaseAt(w.time + d).phase === k)) wrongPhase++;
    }
    for (const b of [...seen]) if (!b.active) { seen.delete(b); entered.delete(b); }
    if (!w.soul.alive) w.soul.hp = w.soul.maxHp;
  }
  return { w, e, phases, counts, spawned, onScreenSpawns, notOrange, wrongPhase, ringBad, inBand, started, lost, icons, iconBad };
}

describe('Ember behaviour', () => {
  it('L1/L10/L20 over 40 s: phases, orange only, off screen (rings just outside the box), a constant mover takes 0 damage', () => {
    const expected: Record<number, string[]> = {
      1: ['embers@0.0', 'breather@8.0', 'embers@9.0'],
      10: ['embers@0.0', 'breather@8.0', 'sweep@9.0', 'breather@17.0', 'embers@18.0'],
      20: ['embers@0.0', 'breather@8.0', 'sweep@9.0', 'breather@17.0', 'wildfire@18.0', 'breather@26.0', 'embers@27.0'],
    };
    for (const level of [1, 10, 20]) {
      const r = runEmber(level, 40, true);
      // eslint-disable-next-line no-console
      console.log(`Ember L${level} 40 s: ${r.phases.join(' ')} | spawned ${JSON.stringify(r.spawned)} | arrived ${JSON.stringify(r.counts)} | non-orange ${r.notOrange}, off-screen-rule breaks ${r.onScreenSpawns}, rings inside the box ${r.ringBad}, spawns in a band ${r.inBand}, warning icons ${r.icons} (in a band or inside the box ${r.iconBad}), wrong phase ${r.wrongPhase} | mover HP lost ${r.lost}`);
      expect(r.phases.slice(0, expected[level]!.length)).toEqual(expected[level]);
      expect(r.notOrange).toBe(0);
      expect(r.onScreenSpawns).toBe(0);
      expect(r.ringBad).toBe(0);
      expect(r.inBand).toBe(0);
      expect(r.iconBad).toBe(0);
      expect(r.icons).toBe(r.spawned.wildfire ?? 0);
      expect(r.wrongPhase).toBe(0);
      expect(r.lost).toBe(0);
      expect(r.counts.embers).toBeGreaterThan(0);
      if (level >= 6) expect(r.counts.sweep).toBeGreaterThan(0);
      else expect(r.counts.sweep).toBeUndefined();
      if (level >= 15) expect(r.counts.wildfire).toBeGreaterThan(0);
      else expect(r.counts.wildfire).toBeUndefined();
      for (const atk of Object.keys(r.counts)) expect(r.started.has(atk)).toBe(true);
    }
  });
  it('a still soul is hurt by Ember alone (orange)', () => {
    const r = runEmber(20, 40, false);
    expect(r.lost).toBeGreaterThan(0);
  });
  it('wildfire rings grow, and the hitbox is exactly the drawn ring (inner and outer edge probes)', () => {
    const w = new World(640, 369);
    const e = new Ember(w, 5);
    const p = resolveLevel(emberConfig, 20).attacks.wildfire!;
    const b = e.ring(p, 'left')!;
    expect(b.x).toBeLessThan(-w.box.halfWidth);
    const drawn = new B();
    let last = b.a;
    for (let i = 0; i < 120 && b.active; i++) {
      w.pool.update(STEP, w.box);
      if (!b.active) break;
      expect(b.a).toBeGreaterThan(last);
      last = b.a;
      // Drawn (interpolated at alpha 1) primitives == collision primitives.
      const a: number[] = [], d: number[] = [];
      bulletPrimitives(b, (q) => void (q.kind === 'rect' && a.push(q.r.x, q.r.y, q.r.hw, q.r.hh, q.r.rotation ?? 0)));
      bulletPrimitives(interpBullet(b, 1, drawn), (q) => void (q.kind === 'rect' && d.push(q.r.x, q.r.y, q.r.hw, q.r.hh, q.r.rotation ?? 0)));
      expect(d).toEqual(a);
      // Probes along a chord's middle (angle of segment 3): just inside / outside both edges.
      // Between two flame tongues (they sit at (i + 0.5) * 11.25 deg): a chord's middle at 22.5 deg.
      const t = (2 * Math.PI * 3) / 48;
      const mid = b.a * Math.cos(Math.PI / 48);
      const at = (rr: number) => ({ x: b.x + Math.cos(t) * rr, y: b.y + Math.sin(t) * rr, r: 1 });
      expect(bulletHitsCircle(b, at(mid + b.b / 2 + 0.9))).toBe(true);
      if (b.a > 100) expect(bulletHitsCircle(b, at(mid + b.b / 2 + 1.1))).toBe(false);
      // A tongue's tip (long tongue 0, at 5.6 deg) hits; past it misses.
      const tg = ringTongue(b, 0);
      const tip = tg.form.parts[0] as { cx: number };
      const tx = tg.x + Math.cos(tg.rot) * tip.cx, ty = tg.y + Math.sin(tg.rot) * tip.cx;
      expect(bulletHitsCircle(b, { x: tx + Math.cos(tg.rot) * 0.9, y: ty + Math.sin(tg.rot) * 0.9, r: 1 })).toBe(true);
      expect(bulletHitsCircle(b, { x: tx + Math.cos(tg.rot) * 1.6, y: ty + Math.sin(tg.rot) * 1.6, r: 1 })).toBe(false);
      if (mid - b.b / 2 - 1.1 > 0) {
        expect(bulletHitsCircle(b, at(mid - b.b / 2 - 0.9))).toBe(true);
        expect(bulletHitsCircle(b, at(mid - b.b / 2 - 1.1))).toBe(false);
      }
      // The ring's center is hollow.
      if (b.a > 20) expect(bulletHitsCircle(b, { x: b.x, y: b.y, r: 3 })).toBe(false);
    }
    expect(last).toBeGreaterThan(100);
  });
  it('the flame wall: covers most of the box height, every drawn part is its hitbox', () => {
    const p = resolveLevel(emberConfig, 20).attacks.sweep!;
    const f = flameWallForm(330 * p.cover!, emberConfig.rules.sweepThickness);
    const core = f.parts[0]!;
    expect(core.kind === 'rect' && core.hh * 2).toBeCloseTo(330 * p.cover!, 6);
    const b = new B().init({ shape: 'composite', form: f, a: 0, x: 0, y: 0, damage: 1 });
    // Through the core's middle and through a tongue's tip region.
    expect(bulletHitsCircle(b, { x: 0, y: 100, r: 1 })).toBe(true);
    expect(bulletHitsCircle(b, { x: 0, y: (330 * p.cover!) / 2 + 2, r: 1 })).toBe(false);
  });
  it('fireNow fires each attack (DebugScene): embers and sweeps off screen, rings just outside the box', () => {
    for (const atk of ['embers', 'sweep', 'wildfire'] as const) {
      const w = new World(640, 369);
      const e = new Ember(w, 5);
      expect(e.fireNow(atk, 20)).toBe(true);
      const live = w.pool.all.filter((b) => b.active);
      expect(live.length).toBeGreaterThan(0);
      for (const b of live) {
        if (atk === 'wildfire') {
          // The warning icon comes first: harmless decor outside the box; the ring follows it.
          expect(b.decor).toBe(true);
          expect(b.damage).toBe(0);
        } else expect(b.kind).toBe('orange');
        const p = w.box.toWorld(b);
        if (atk === 'wildfire') expect(Math.abs(b.x) > w.box.halfWidth || Math.abs(b.y) > w.box.halfHeight).toBe(true);
        else expect(p.x < 0 || p.x > SCREEN_WIDTH || p.y < 0 || p.y > SCREEN_HEIGHT).toBe(true);
      }
    }
  });
});
