import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { mortimerConfig } from './mortimer.config';
import { Mortimer } from './Mortimer';
import { Prism } from '../prism/Prism';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { bulletCircle, type Bullet } from '../../combat/Bullet';
import { bulletHitsCircle } from '../../combat/hitTest';
import { interpBullet } from '../../render/interp';
import { Bullet as B } from '../../combat/Bullet';
import { projectileHurts } from '../../combat/projectile';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../tuning';
import { registry } from '../registry';

const STILL = { dx: 0, dy: 0, slow: false };
const attacksAt = (l: number) => Object.keys(resolveLevel(mortimerConfig, l).attacks).sort();

describe('Mortimer config', () => {
  it('validates, and is registered as slot 2 with the snowman shape', () => {
    expect(validateConfig(mortimerConfig)).toEqual([]);
    expect(registry[1]).toMatchObject({ id: 'mortimer', shape: 'snowman', maxLevel: 20 });
  });
  it('snowfall 1-20; roll joins at 6; blizzard at 15', () => {
    for (const l of [1, 5]) expect(attacksAt(l)).toEqual(['snowfall']);
    for (const l of [6, 14]) expect(attacksAt(l)).toEqual(['roll', 'snowfall']);
    for (const l of [15, 20]) expect(attacksAt(l)).toEqual(['blizzard', 'roll', 'snowfall']);
  });
  it('resolves band edges and midpoints (counts are integers)', () => {
    expect(resolveLevel(mortimerConfig, 1).attacks.snowfall).toMatchObject({ cooldown: 1.2, count: 5 });
    expect(resolveLevel(mortimerConfig, 10).attacks.roll!.cooldown).toBeCloseTo(3.2 + (2.3 - 3.2) * (4 / 8));
    expect(resolveLevel(mortimerConfig, 20).attacks.blizzard).toMatchObject({ cooldown: 2.4, count: 4 });
    for (let l = 1; l <= 20; l++) for (const a of Object.values(resolveLevel(mortimerConfig, l).attacks)) expect(Number.isInteger(a!.count)).toBe(true);
  });
  it('difficulty never decreases with level, per parameter', () => {
    const up = ['damage', 'speed', 'count', 'sway', 'size', 'growth', 'length'];
    for (const atk of ['snowfall', 'roll', 'blizzard'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(mortimerConfig, l).attacks[atk];
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
});

/** Run Mortimer (and optionally Prism) for `seconds`, tracking spawns. */
function runMortimer(level: number, seconds: number, input = STILL) {
  const w = new World(640, 369);
  const m = new Mortimer(w, 2);
  m.setLevel(level);
  const phases: string[] = [];
  w.bus.on('mortimerPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started: string[] = [];
  w.bus.on('attackStarted', (e) => started.push(e.attack));
  const seen = new Set<Bullet>();
  const entered = new Set<Bullet>();
  const counts: Record<string, number> = {};
  let onScreenSpawns = 0;
  let notBlue = 0;
  let wrongPhase = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    m.tick(STEP);
    for (const b of w.pool.all) {
      if (!b.active || seen.has(b)) continue;
      seen.add(b);
      if (b.kind !== 'blue') notBlue++;
      const p = w.box.toWorld(b);
      if (p.x >= 0 && p.x <= SCREEN_WIDTH && p.y >= 0 && p.y <= SCREEN_HEIGHT) onScreenSpawns++;
    }
    w.step(input, STEP);
    for (const b of w.pool.all) {
      if (!b.active || entered.has(b)) continue;
      const atk = b.shape === 'composite' ? 'blizzard' : b.a > mortimerConfig.rules.flakeSize + 1 ? 'roll' : 'snowfall';
      // Snowfall arrives when a flake reaches the top edge's height (edge flakes sway beside the box).
      if (atk === 'snowfall' ? b.y < -w.box.halfHeight : Math.abs(b.x) > w.box.halfWidth || Math.abs(b.y) > w.box.halfHeight) continue;
      entered.add(b);
      counts[atk] = (counts[atk] ?? 0) + 1;
      if (![-2 * STEP, 0, STEP].some((d) => m.phaseAt(w.time + d).phase === atk)) wrongPhase++;
    }
    for (const b of [...seen]) if (!b.active) { seen.delete(b); entered.delete(b); }
  }
  return { w, m, phases, counts, onScreenSpawns, notBlue, wrongPhase, started };
}

describe('Mortimer behaviour', () => {
  it('phases, blue only, off screen only, still soul untouched (L1, L10, L20 over 40 s)', () => {
    const expected: Record<number, string[]> = {
      1: ['snowfall@0.0', 'breather@8.0', 'snowfall@9.0'],
      10: ['snowfall@0.0', 'breather@8.0', 'roll@9.0', 'breather@17.0', 'snowfall@18.0'],
      20: ['snowfall@0.0', 'breather@8.0', 'roll@9.0', 'breather@17.0', 'blizzard@18.0', 'breather@26.0', 'snowfall@27.0'],
    };
    for (const level of [1, 10, 20]) {
      const r = runMortimer(level, 40);
      // eslint-disable-next-line no-console
      console.log(`Mortimer L${level}: ${r.phases.join(' ')} | entered ${JSON.stringify(r.counts)} | on-screen spawns ${r.onScreenSpawns}, non-blue ${r.notBlue}, wrong phase ${r.wrongPhase}, still soul hp ${r.w.soul.hp}`);
      expect(r.phases.slice(0, expected[level]!.length)).toEqual(expected[level]);
      expect(r.notBlue).toBe(0);
      expect(r.onScreenSpawns).toBe(0);
      expect(r.wrongPhase).toBe(0);
      expect(r.w.soul.hp).toBe(r.w.soul.maxHp);
      expect(r.counts.snowfall).toBeGreaterThan(0);
      if (level >= 6) expect(r.counts.roll).toBeGreaterThan(0);
      if (level >= 15) expect(r.counts.blizzard).toBeGreaterThan(0);
      if (level < 15) expect(r.counts.blizzard).toBeUndefined();
      // Profile box: attackStarted for every attack that ran.
      for (const atk of Object.keys(r.counts)) expect(r.started).toContain(atk);
    }
  });
  it('a moving soul does get hurt by Mortimer alone (blue)', () => {
    const r = runMortimer(20, 40, { dx: 1, dy: 0, slow: false });
    expect(r.w.soul.hp).toBeLessThan(r.w.soul.maxHp);
  });
  it('snowballs grow, and their hitbox is exactly the drawn size while growing', () => {
    const w = new World(640, 369);
    const m = new Mortimer(w, 2);
    m.fireNow('roll', 20);
    const balls = w.pool.all.filter((b) => b.active);
    expect(balls.length).toBeGreaterThan(0);
    const b = balls[0]!;
    const r0 = b.a;
    const c = { x: 0, y: 0, r: 0 };
    const drawn = new B();
    let last = r0;
    for (let i = 0; i < 300 && b.active; i++) {
      w.pool.update(STEP, w.box);
      if (!b.active) break;
      // Drawn shape (interpolated at alpha 1, as the hitbox overlay draws) == collision shape.
      const hit = bulletCircle(b, c).r;
      const draw = bulletCircle(interpBullet(b, 1, drawn), { x: 0, y: 0, r: 0 }).r;
      expect(draw).toBe(hit);
      expect(hit).toBe(b.a);
      expect(hit).toBeGreaterThan(last);
      last = hit;
      // A soul just inside / just outside the edge.
      expect(bulletHitsCircle(b, { x: b.x + hit + 0.9, y: b.y, r: 1 })).toBe(true);
      expect(bulletHitsCircle(b, { x: b.x + hit + 1.1, y: b.y, r: 1 })).toBe(false);
    }
    expect(last).toBeGreaterThan(r0 + 5);
  });
  it('fireNow fires each attack from off screen (DebugScene)', () => {
    for (const atk of ['snowfall', 'roll', 'blizzard'] as const) {
      const w = new World(640, 369);
      const m = new Mortimer(w, 2);
      expect(m.fireNow(atk, 20)).toBe(true);
      const live = w.pool.all.filter((b) => b.active);
      expect(live.length).toBeGreaterThan(0);
      for (const b of live) {
        const p = w.box.toWorld(b);
        expect(p.x < 0 || p.x > SCREEN_WIDTH || p.y < 0 || p.y > SCREEN_HEIGHT).toBe(true);
      }
    }
  });
});

describe('Prism 10 + Mortimer 10', () => {
  it('moving costs more than standing still (the pairing creates tension)', () => {
    const result: Record<string, { total: number; byOwner: Record<string, number> }> = {};
    for (const [name, input] of [['still', STILL], ['moving', null]] as const) {
      const w = new World(640, 369);
      const p = new Prism(w, 1);
      const m = new Mortimer(w, 2);
      p.setLevel(10);
      m.setLevel(10);
      const byOwner: Record<string, number> = { prism: 0, mortimer: 0 };
      let total = 0;
      let dir = 1;
      for (let i = 0; i < 60 * 40; i++) {
        p.tick(STEP);
        m.tick(STEP);
        // Scripted mover: sweeps left and right across the box, never stopping.
        if (Math.abs(w.soul.pos.x) > w.box.halfWidth - 20) dir = -Math.sign(w.soul.pos.x);
        const hp = w.soul.hp;
        w.step(input ?? { dx: dir, dy: 0, slow: false }, STEP);
        const lost = hp - w.soul.hp;
        if (lost > 0) {
          total += lost;
          // Whose bullet hurt: one touching the soul whose type hurts in this step's state.
          const soulC = { x: w.soul.pos.x, y: w.soul.pos.y, r: w.soul.hitRadius };
          const hurter = w.pool.all.find((b) => b.active && b.damage >= lost - 1e-9 && projectileHurts(b.kind, w.soul.moving) && bulletHitsCircle(b, soulC));
          const owner = hurter?.owner ?? '?';
          byOwner[owner] = (byOwner[owner] ?? 0) + lost;
        }
        if (!w.soul.alive) w.soul.hp = w.soul.maxHp; // keep counting after a "death"
      }
      result[name] = { total, byOwner };
    }
    // eslint-disable-next-line no-console
    console.log(`Prism 10 + Mortimer 10, 40 s: ${JSON.stringify(result)}`);
    expect(result.still!.byOwner.mortimer).toBe(0);
    expect(result.moving!.byOwner.mortimer).toBeGreaterThan(0);
    expect(result.moving!.byOwner['?'] ?? 0).toBe(0);
    expect(result.still!.byOwner['?'] ?? 0).toBe(0);
  });
});
