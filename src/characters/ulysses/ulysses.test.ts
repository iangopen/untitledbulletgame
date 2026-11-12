import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { SWORD_FLAGS, SWORD_FORM, ulyssesConfig } from './ulysses.config';
import { Ulysses } from './Ulysses';
import { Mortimer } from '../mortimer/Mortimer';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import { Bullet, rectCorners } from '../../combat/Bullet';
import { bulletPrimitives, type Primitive } from '../../combat/composite';
import { bulletHitsCircle } from '../../combat/hitTest';
import { interpBullet } from '../../render/interp';
import { registry } from '../registry';
import { Director } from '../../director/Director';
import { TimerMode } from '../../director/modes/TimerMode';
import { blizzardSync, installInteractions, prismSwordSplit } from '../../director/interactions';
import type { MoveInput } from '../../core/Soul';

const STILL: MoveInput = { dx: 0, dy: 0, slow: false };
const attacksAt = (l: number) => Object.keys(resolveLevel(ulyssesConfig, l).attacks).sort();

describe('Ulysses config', () => {
  it('validates; registered as slot 3 with the shield shape', () => {
    expect(validateConfig(ulyssesConfig)).toEqual([]);
    expect(registry[2]).toMatchObject({ id: 'ulysses', shape: 'shield', maxLevel: 20 });
  });
  it('summon 1-20; axe joins at 6; rain at 15', () => {
    for (const l of [1, 5]) expect(attacksAt(l)).toEqual(['summon']);
    for (const l of [6, 14]) expect(attacksAt(l)).toEqual(['axe', 'summon']);
    for (const l of [15, 20]) expect(attacksAt(l)).toEqual(['axe', 'rain', 'summon']);
  });
  it('difficulty never decreases with level, per parameter', () => {
    const up = ['damage', 'speed', 'count', 'arc', 'reach', 'double'];
    const down = ['cooldown', 'grow', 'windup', 'jitter', 'fallGap'];
    for (const atk of ['summon', 'axe', 'rain'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(ulyssesConfig, l).attacks[atk];
        if (!a) continue;
        if (prev) {
          for (const k of Object.keys(a)) {
            if (up.includes(k)) expect(a[k]!, `${atk}.${k} L${l}`).toBeGreaterThanOrEqual(prev[k]!);
            else if (down.includes(k)) expect(a[k]!, `${atk}.${k} L${l}`).toBeLessThanOrEqual(prev[k]!);
            else throw new Error(`unclassified ${atk}.${k}`);
          }
        }
        prev = a;
      }
    }
  });
});

/** Every primitive of the bullet at full size (as it will be at the shine) is outside the box (AABB test, conservative). */
function formedOutside(w: World, b: Bullet): boolean {
  const full = interpBullet(b, 1, new Bullet());
  full.armed = true; // full size, not growing in
  return !bulletPrimitives(full, (p) => {
    const a = primAabb(p);
    return a.x1 > -w.box.halfWidth && a.x0 < w.box.halfWidth && a.y1 > -w.box.halfHeight && a.y0 < w.box.halfHeight;
  });
}

function primAabb(p: Primitive): { x0: number; y0: number; x1: number; y1: number } {
  if (p.kind === 'circle') return { x0: p.c.x - p.c.r, x1: p.c.x + p.c.r, y0: p.c.y - p.c.r, y1: p.c.y + p.c.r };
  const pts = p.kind === 'tri'
    ? [{ x: p.t.ax, y: p.t.ay }, { x: p.t.bx, y: p.t.by }, { x: p.t.cx, y: p.t.cy }]
    : rectCorners(p.r, [0, 1, 2, 3].map(() => ({ x: 0, y: 0 })));
  return { x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) };
}

function runUlysses(level: number, seconds: number, input: (w: World) => MoveInput = () => STILL) {
  const w = new World(640, 369);
  const u = new Ulysses(w, 3);
  u.setLevel(level);
  const phases: string[] = [];
  w.bus.on('ulyssesPhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const seen = new Set<Bullet>();
  const shone = new Set<Bullet>();
  const counts: Record<string, number> = {};
  let formedInside = 0;
  let goldHits = 0;
  let wrongPhase = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    u.tick(STEP);
    for (const b of w.pool.all) {
      if (!b.active || seen.has(b)) continue;
      seen.add(b);
      const atk = !(b.flags & SWORD_FLAGS.sword) ? 'axe' : b.onStep ? 'rain' : 'summon';
      counts[atk] = (counts[atk] ?? 0) + 1;
      if (!formedOutside(w, b)) formedInside++;
    }
    const hp = w.soul.hp;
    const soul = { x: w.soul.pos.x, y: w.soul.pos.y, r: w.soul.hitRadius };
    const goldTouching = w.pool.all.filter((b) => b.active && !b.armed && bulletHitsCircle(b, soul));
    w.step(input(w), STEP);
    if (goldTouching.length && w.soul.hp < hp && !w.pool.all.some((b) => b.active && b.armed && bulletHitsCircle(b, soul))) goldHits++;
    for (const b of w.pool.all) {
      if (!b.active || !b.armed || shone.has(b)) continue;
      shone.add(b);
      const atk = !(b.flags & SWORD_FLAGS.sword) ? 'axe' : b.onStep ? 'rain' : 'summon';
      // Within a step either side (a bullet's age starts counting on its spawn step).
      if (![-2 * STEP, 0, 1.5 * STEP].some((d) => u.phaseAt(w.time + d).phase === atk)) wrongPhase++;
    }
    for (const b of [...seen]) if (!b.active) { seen.delete(b); shone.delete(b); }
    w.soul.iframes = 1; // count gold contacts without dying; damage is checked separately
  }
  return { w, u, phases, counts, formedInside, goldHits, wrongPhase };
}

describe('Ulysses behaviour', () => {
  it('phases, counts, gold never hurts, gold forms outside the box (L1, L10, L20 over 40 s)', () => {
    const expected: Record<number, string[]> = {
      1: ['summon@0.0', 'breather@8.0', 'summon@9.0'],
      10: ['summon@0.0', 'breather@8.0', 'axe@9.0', 'breather@17.0', 'summon@18.0'],
      20: ['summon@0.0', 'breather@8.0', 'axe@9.0', 'breather@17.0', 'rain@18.0', 'breather@26.0', 'summon@27.0'],
    };
    for (const level of [1, 10, 20]) {
      const r = runUlysses(level, 40);
      // eslint-disable-next-line no-console
      console.log(`Ulysses L${level}: ${r.phases.join(' ')} | spawned ${JSON.stringify(r.counts)} | formed inside ${r.formedInside} | gold hits ${r.goldHits} | shines outside phase ${r.wrongPhase}`);
      expect(r.phases.slice(0, expected[level]!.length)).toEqual(expected[level]);
      expect(r.formedInside).toBe(0);
      expect(r.wrongPhase).toBe(0);
      expect(r.counts.summon).toBeGreaterThan(0);
      if (level >= 6) expect(r.counts.axe).toBeGreaterThan(0);
      if (level >= 15) expect(r.counts.rain).toBeGreaterThan(0);
    }
  });

  it('a gold sword never damages, even overlapping a moving soul for its whole gold stage', () => {
    const w = new World(640, 369);
    const u = new Ulysses(w, 3);
    u.fireNow('summon', 20);
    const s = w.pool.all.find((b) => b.active)!;
    // Put the soul right on the forming sword (forced, for the test) and keep moving.
    let gold = 0;
    let hpWhileGold = w.soul.hp;
    while (!s.armed) {
      s.x = w.soul.pos.x;
      s.y = w.soul.pos.y;
      w.step({ dx: 1, dy: 0, slow: false }, STEP);
      if (!s.armed) {
        gold++;
        hpWhileGold = w.soul.hp;
      }
    }
    expect(gold).toBeGreaterThan(30);
    expect(hpWhileGold).toBe(w.soul.maxHp);
    expect(w.soul.hp).toBeLessThan(w.soul.maxHp); // and the same overlap hurts on the step it shines
  });

  it('a summoned sword locks onto the soul at the shine; a soul that moves after the shine is not hit', () => {
    const w = new World(640, 369);
    const u = new Ulysses(w, 3);
    u.fireNow('summon', 1);
    const s = w.pool.all.find((b) => b.active)!;
    // The soul wanders during the gold stage (the sword must not track it then).
    let shineAt = -1;
    let target = { x: 0, y: 0 };
    for (let i = 0; i < 600 && s.active; i++) {
      const wasArmed = s.armed;
      w.step(shineAt < 0 ? { dx: Math.sin(i / 7) > 0 ? 1 : -1, dy: 0, slow: false } : { dx: 0, dy: 1, slow: false }, STEP);
      if (!wasArmed && s.armed) {
        shineAt = w.time;
        target = { x: w.soul.pos.x, y: w.soul.pos.y };
        const dir = Math.atan2(target.y - s.y, target.x - s.x);
        expect(Math.atan2(s.vy, s.vx)).toBeCloseTo(dir, 9);
        // eslint-disable-next-line no-console
        console.log(`summon: shine at ${shineAt.toFixed(3)} s, locked on soul at (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`);
      }
    }
    expect(shineAt).toBeGreaterThan(0);
    expect(w.soul.hp).toBe(w.soul.maxHp); // moved down after the shine: the sword flew through where it was
  });

  it('a soul that stays where it was at the shine is hit', () => {
    const w = new World(640, 369);
    new Ulysses(w, 3).fireNow('summon', 1);
    for (let i = 0; i < 600; i++) w.step(STILL, STEP);
    expect(w.soul.hp).toBeLessThan(w.soul.maxHp);
  });

  it('axe: pivots on its corner and the drawn axe is the hitbox through the whole arc (rotated, resized box)', () => {
    for (const [rot, resize] of [[0, false], [Math.PI / 6, false], [0, true]] as const) {
      const w = new World(640, 369);
      w.box.rotateTo(rot, 0);
      w.step(STILL, STEP);
      const u = new Ulysses(w, 3);
      u.fireNow('axe', 20);
      const axe = w.pool.all.find((b) => b.active)!;
      expect(axe.flags & SWORD_FLAGS.sword).toBe(0);
      const R = resolveLevel(ulyssesConfig, 20).attacks.axe!.reach!;
      const cx = Math.sign(axe.x);
      const cy = Math.sign(axe.y);
      let steps = 0;
      let swept = 0;
      let last = axe.rotation;
      const drawn = new Bullet();
      while (axe.active && steps < 600) {
        if (resize && steps === 70) w.box.resizeTo(300, 240, 0.4, 'linear');
        w.step(STILL, STEP);
        w.soul.iframes = 1;
        steps++;
        if (!axe.active) break;
        // Pivot = the current corner, also while the box resizes.
        expect(axe.x).toBeCloseTo(cx * w.box.halfWidth, 9);
        expect(axe.y).toBeCloseTo(cy * w.box.halfHeight, 9);
        if (!axe.armed) continue;
        swept += Math.abs(axe.rotation - last);
        last = axe.rotation;
        // Drawn primitives (alpha 1) == collision primitives.
        const a: string[] = [];
        const d: string[] = [];
        bulletPrimitives(axe, (p) => void a.push(JSON.stringify(p)));
        bulletPrimitives(interpBullet(axe, 1, drawn), (p) => void d.push(JSON.stringify(p)));
        expect(d).toEqual(a);
        // Probe the handle's side at mid-length, rotated with the axe: 0.4 px out hits, 0.6 px misses.
        const c = Math.cos(axe.rotation);
        const sn = Math.sin(axe.rotation);
        const probe = (lx: number, ly: number) => ({ x: axe.x + lx * c - ly * sn, y: axe.y + lx * sn + ly * c, r: 0.5 });
        expect(bulletHitsCircle(axe, probe(R / 2, 3.4))).toBe(true);
        expect(bulletHitsCircle(axe, probe(R / 2, 3.6))).toBe(false);
        expect(bulletHitsCircle(axe, probe(R / 2, -3.6))).toBe(false);
      }
      expect(swept).toBeCloseTo(resolveLevel(ulyssesConfig, 20).attacks.axe!.arc!, 2);
    }
  });

  it('sword rain: 3x the swords, near-simultaneous shines, and an opening wider than the soul in every row', () => {
    for (const level of [15, 20]) {
      const w = new World(640, 369);
      const u = new Ulysses(w, 3);
      const p = resolveLevel(ulyssesConfig, level).attacks.rain!;
      const rows: { count: number; shineSpread: number; fallSpread: number; minGap: number }[] = [];
      for (let row = 0; row < 12; row++) {
        w.pool.clear();
        u.fireNow('rain', level);
        const swords = w.pool.all.filter((b) => b.active);
        // Narrowest gap: sort by x, crossguard edges at x +- swordWidth.
        const xs = swords.map((b) => b.x).sort((a, b) => a - b);
        const hw = ulyssesConfig.rules.swordWidth;
        const gaps = xs.slice(1).map((x, i) => x - xs[i]! - 2 * hw);
        const widest = Math.max(...gaps, xs[0]! - hw + w.box.halfWidth, w.box.halfWidth - xs[xs.length - 1]! - hw);
        const shine = new Map<Bullet, number>();
        const fall = new Map<Bullet, number>();
        for (let i = 0; i < 240; i++) {
          w.step(STILL, STEP);
          w.soul.iframes = 1;
          for (const b of swords) {
            if (b.armed && !shine.has(b)) shine.set(b, w.time);
            if (b.vy > 0 && !fall.has(b)) fall.set(b, w.time);
          }
        }
        const sp = (m: Map<Bullet, number>) => Math.max(...m.values()) - Math.min(...m.values());
        rows.push({ count: swords.length, shineSpread: sp(shine), fallSpread: sp(fall), minGap: widest });
      }
      const soulD = 2 * w.soul.hitRadius;
      // eslint-disable-next-line no-console
      console.log(`rain L${level}: ${p.count} slots, ${rows[0]!.count} swords per row (was ${level === 15 ? 6 : 9}); fall start spread max ${Math.max(...rows.map((r) => r.fallSpread)).toFixed(3)} s; narrowest per-row opening ${Math.min(...rows.map((r) => r.minGap)).toFixed(1)} px vs soul diameter ${soulD} px`);
      for (const r of rows) {
        expect(r.minGap).toBeGreaterThan(soulD);
        expect(r.minGap).toBeGreaterThanOrEqual(ulyssesConfig.rules.rainGap - 1e-9);
        expect(r.fallSpread).toBeLessThanOrEqual(p.jitter! + STEP + 1e-9);
      }
      expect(p.count).toBe(level === 15 ? 18 : 27);
    }
  });
});

describe('combos', () => {
  it('are installed only when both characters are active', () => {
    const ids = (roster: Record<string, number>) => {
      const w = new World(640, 369);
      const got: string[] = [];
      const d = new Director(w, roster, new TimerMode(5));
      // Probe: a sword at a refraction prop / a blizzard phase, and see what reacts.
      w.bus.on('comboTriggered', (e) => got.push(e.id));
      w.props.push({ shape: 'triangle', x: 0, y: 0, r: 60, rotation: 0, color: 0, refracts: true });
      w.pool.spawn({ shape: 'composite', form: SWORD_FORM, a: 0, x: -1, y: 0, vx: 100, faceVelocity: true, damage: 1, owner: 'ulysses', flags: SWORD_FLAGS.sword, noPop: true });
      w.bus.emit('mortimerPhaseChanged', { owner: 'mortimer', phase: 'blizzard', next: 'blizzard' });
      w.pool.spawn({ shape: 'composite', form: SWORD_FORM, a: 0, x: 300, y: 300, damage: 1, owner: 'ulysses', flags: SWORD_FLAGS.sword, noPop: true, armDelay: 2 });
      w.step(STILL, STEP);
      d.dispose();
      return [...new Set(got)].sort();
    };
    expect(ids({ prism: 5 })).toEqual([]);
    expect(ids({ ulysses: 5 })).toEqual([]);
    expect(ids({ mortimer: 5 })).toEqual([]);
    expect(ids({ prism: 5, mortimer: 5 })).toEqual([]);
    expect(ids({ prism: 5, ulysses: 5 })).toEqual(['prism-ulysses-split']);
    expect(ids({ mortimer: 5, ulysses: 5 })).toEqual(['mortimer-ulysses-blizzard-sync']);
    expect(ids({ prism: 5, mortimer: 5, ulysses: 5 })).toEqual(['mortimer-ulysses-blizzard-sync', 'prism-ulysses-split']);
  });

  it('Prism + Ulysses: a white sword through a refraction prism becomes exactly three that ignore prisms', () => {
    const w = new World(640, 369);
    const off = installInteractions(w, new Set(['prism', 'ulysses']), [prismSwordSplit]);
    const events: { t: number; count: number }[] = [];
    w.bus.on('comboTriggered', (e) => events.push({ t: w.time, count: e.count }));
    w.props.push({ shape: 'triangle', x: 0, y: 0, r: 42, rotation: -Math.PI / 2, color: 0, refracts: true });
    w.pool.spawn({ shape: 'composite', form: SWORD_FORM, a: 0, x: -300, y: 0, vx: 270, faceVelocity: true, damage: 10, owner: 'ulysses', kind: 'white', flags: SWORD_FLAGS.sword, noPop: true });
    // A gold sword flying through the prism does nothing (it is still gold the whole way).
    w.pool.spawn({ shape: 'composite', form: SWORD_FORM, a: 0, x: 0, y: -300, vy: 270, faceVelocity: true, damage: 10, owner: 'ulysses', flags: SWORD_FLAGS.sword, noPop: true, armDelay: 5 });
    for (let i = 0; i < 120; i++) {
      w.step(STILL, STEP);
      w.soul.iframes = 1;
    }
    off();
    // eslint-disable-next-line no-console
    console.log(`prism combo events: ${JSON.stringify(events.map((e) => ({ t: +e.t.toFixed(3), count: e.count })))}`);
    expect(events).toHaveLength(1);
    expect(events[0]!.count).toBe(3);
    const split = w.pool.all.filter((b) => b.active && b.flags & SWORD_FLAGS.split);
    expect(split.length).toBe(3); // and they passed back out through the prism without splitting again
    expect(split.every((b) => b.kind === 'white' && b.armed)).toBe(true);
  });

  it('Mortimer + Ulysses: in a blizzard phase gold swords stay gold longer and shine together', () => {
    const shineTimes = (blizzard: boolean) => {
      const w = new World(640, 369);
      const off = installInteractions(w, new Set(['mortimer', 'ulysses']), [blizzardSync]);
      const syncs: { t: number; at: number; count: number }[] = [];
      w.bus.on('comboTriggered', (e) => syncs.push({ t: +w.time.toFixed(3), at: +(e.at ?? 0).toFixed(3), count: e.count }));
      if (blizzard) w.bus.emit('mortimerPhaseChanged', { owner: 'mortimer', phase: 'blizzard', next: 'blizzard' });
      const u = new Ulysses(w, 3);
      u.fireNow('rain', 20); // 9 swords, normally shining one by one
      for (let i = 0; i < 20; i++) w.step(STILL, STEP);
      u.fireNow('summon', 20);
      const shines: number[] = [];
      const seen = new Set<Bullet>();
      for (let i = 0; i < 240; i++) {
        w.step(STILL, STEP);
        w.soul.iframes = 1;
        for (const b of w.pool.all) if (b.active && b.armed && !seen.has(b)) { seen.add(b); shines.push(+w.time.toFixed(3)); }
      }
      off();
      return { shines, syncs };
    };
    const normal = shineTimes(false);
    const synced = shineTimes(true);
    // eslint-disable-next-line no-console
    console.log(`blizzard combo: normal shines ${JSON.stringify(normal.shines)}; synced shines ${JSON.stringify(synced.shines)}; sync events ${JSON.stringify(synced.syncs)}`);
    expect(new Set(normal.shines).size).toBeGreaterThan(3);
    expect(new Set(synced.shines).size).toBe(1);
    expect(synced.shines.length).toBe(normal.shines.length);
    expect(synced.shines[0]!).toBeGreaterThan(Math.max(...normal.shines));
    expect(normal.syncs).toEqual([]);
  });

  it('stacked with Prism and Mortimer at 20, everything stays bounded', () => {
    const w = new World(640, 369);
    const d = new Director(w, { prism: 20, mortimer: 20, ulysses: 20 }, new TimerMode(60));
    let peak = 0;
    for (let i = 0; i < 60 * 40; i++) {
      d.step(STILL, STEP);
      w.soul.iframes = 1;
      peak = Math.max(peak, w.pool.activeCount);
    }
    expect(w.pool.dropped).toBe(0);
    expect(peak).toBeLessThan(500);
  });
});

describe('Mortimer snowballs and edge despawn', () => {
  it('a large snowball stays (fully drawn) until its whole shape has left the screen', () => {
    const w = new World(640, 369);
    const m = new Mortimer(w, 2);
    m.fireNow('roll', 20);
    const b = w.pool.all.find((x) => x.active)!;
    let removedOffScreen: boolean | null = null;
    let radius = 0;
    let wasPartlyVisibleOutsideBox = false;
    w.pool.onDespawn = (x) => {
      if (x === b) {
        removedOffScreen = w.pool.offScreen(x, w.box);
        radius = x.a;
      }
    };
    for (let i = 0; i < 60 * 20 && b.active; i++) {
      w.step(STILL, STEP);
      w.soul.iframes = 1;
      // Center well past the box (the old cull point: 72 px) while still partly on screen.
      if (b.active && Math.abs(b.x) > w.box.halfWidth + 72 && !w.pool.offScreen(b, w.box)) wasPartlyVisibleOutsideBox = true;
    }
    // eslint-disable-next-line no-console
    console.log(`snowball removed at radius ${radius.toFixed(1)}, fully off screen: ${removedOffScreen}`);
    expect(wasPartlyVisibleOutsideBox).toBe(true); // the case that used to fade out early
    expect(removedOffScreen).toBe(true);
  });
});
