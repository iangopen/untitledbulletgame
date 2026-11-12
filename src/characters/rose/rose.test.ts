import { describe, expect, it } from 'vitest';
import { resolveLevel, validateConfig } from '../config';
import { Rose } from './Rose';
import { roseConfig, roseForm, thornForm, vineForm, vineWidth } from './rose.config';
import { registry } from '../registry';
import { World } from '../../core/World';
import { STEP } from '../../core/Clock';
import type { Bullet } from '../../combat/Bullet';
import { bulletPrimitives } from '../../combat/composite';
import { bulletHitsCircle as hitTest } from '../../combat/hitTest';
import { aabbInBand, bulletWorldAabb } from '../../combat/bands';
import { SCREEN_HEIGHT, SCREEN_WIDTH, SOUL_RADIUS } from '../../tuning';
import { theme } from '../../render/theme';

const still = { dx: 0, dy: 0, slow: false };
const R = roseConfig.rules;
const isThorn = (b: Bullet) => b.form === thornForm(R.volleySize);
const isVolley = (b: Bullet) => isThorn(b) && b.flags === 0;
const isVine = (b: Bullet) => b.form === vineForm(R.vineLength, R.vineThickness, R.vineThorn, R.vineThornPitch);
const isRose = (b: Bullet) => b.form === roseForm(R.roseSize);
const inside = (w: World, b: Bullet) => Math.abs(b.x) <= w.box.halfWidth && Math.abs(b.y) <= w.box.halfHeight;

describe('Rose config', () => {
  it('validates, sits in grid slot 1 (Prism right after) and has the UCN description', () => {
    expect(validateConfig(roseConfig)).toEqual([]);
    expect(registry.map((e) => e.id).slice(0, 2)).toEqual(['rose', 'prism']);
    expect(roseConfig.description).toBe('Every rose has its thorns. She has several thousand.');
  });
  it('unlocks volley at 1, vine at 6, bloom at 15', () => {
    const at = (l: number) => Object.keys(resolveLevel(roseConfig, l).attacks).sort();
    expect(at(1)).toEqual(['volley']);
    expect(at(5)).toEqual(['volley']);
    expect(at(6)).toEqual(['vine', 'volley']);
    expect(at(14)).toEqual(['vine', 'volley']);
    expect(at(15)).toEqual(['bloom', 'vine', 'volley']);
    expect(at(20)).toEqual(['bloom', 'vine', 'volley']);
  });
  it('the thorn volley keeps the old Prism volley numbers exactly', () => {
    const old = [
      { from: 1, volley: { cooldown: [2.6, 1.8], damage: [4, 6], speed: [105, 142.5], gapSize: [5, 3] } },
      { from: 6, volley: { cooldown: [1.75, 1.3], damage: [6, 9], speed: [142.5, 187.5], gapSize: [3, 2] } },
      { from: 15, volley: { cooldown: [1.25, 1.0], damage: [9, 12], speed: [187.5, 217.5], gapSize: [2, 2] } },
    ];
    roseConfig.bands.forEach((b, i) => expect(b.attacks.volley).toEqual(old[i]!.volley));
    expect([R.volleySize, R.volleySpacing, R.phaseIntensity, R.phaseLength, R.breather]).toEqual([9, 33, 2, 8, 1]);
  });
  it('difficulty never decreases with level', () => {
    const up = ['damage', 'speed', 'count', 'hold', 'ring'];
    const down = ['cooldown', 'gapSize', 'gap'];
    for (const atk of ['volley', 'vine', 'bloom'] as const) {
      let prev: Record<string, number> | undefined;
      for (let l = 1; l <= 20; l++) {
        const a = resolveLevel(roseConfig, l).attacks[atk];
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
  it('accent: deep rose pink, far from the soul red and KR magenta', () => {
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const dist = (a: number, b: number) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!));
    expect(dist(theme.rose, theme.soul)).toBeGreaterThan(100);
    expect(dist(theme.rose, theme.bullet.kr)).toBeGreaterThan(100);
    expect(dist(theme.rose, theme.hpFill)).toBeGreaterThan(100);
  });
});

describe('Rose vine lanes', () => {
  it('every opening is at least the gap (never under soul diameter + 9), for many seeds and every level', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rose = new Rose(new World(0, 0), seed);
      for (let l = 6; l <= 20; l++) {
        const p = resolveLevel(roseConfig, l).attacks.vine!;
        for (const len of [330, 450, 225]) {
          const lanes = rose.vineLanes(len, p.count!, p.gap!);
          const w = vineWidth(R);
          const edges = [-len / 2, ...lanes.flatMap((u) => [u - w / 2, u + w / 2]), len / 2];
          for (let i = 0; i < edges.length; i += 2) {
            const gap = edges[i + 1]! - edges[i]!;
            expect(gap).toBeGreaterThanOrEqual(Math.max(p.gap!, R.vineMinGap) - 1e-9);
            expect(gap).toBeGreaterThan(SOUL_RADIUS * 2);
          }
          if (len >= 330) expect(lanes.length).toBe(p.count!);
        }
      }
    }
  });
});

describe('Rose shapes: drawn == hitbox', () => {
  it('thorn, vine and rose parts are the collision primitives (probes inside a part hit, beside it miss)', () => {
    const w = new World(0, 0);
    const vine = w.pool.spawn({ shape: 'composite', form: vineForm(R.vineLength, R.vineThickness, R.vineThorn, R.vineThornPitch), a: 0, x: 0, y: 0, rotation: 0.3, damage: 1 })!;
    let n = 0;
    bulletPrimitives(vine, () => void n++);
    expect(n).toBe(vine.form!.parts.length);
    const c = Math.cos(0.3), s = Math.sin(0.3);
    // On the stem 100 px behind the tip: hit; 0.5 px beyond the stem's edge, between thorns: miss.
    const at = (d: number, off: number) => ({ x: -c * d - s * off, y: -s * d + c * off });
    const soul = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, r: 0.01 });
    expect(hitTest(vine, soul(at(100, 0)))).toBe(true);
    expect(hitTest(vine, soul(at(100 - R.vineThornPitch * 0.1, R.vineThickness / 2 + R.vineThorn + 0.5)))).toBe(false);
    const thorn = w.pool.spawn({ shape: 'composite', form: thornForm(R.volleySize), a: 0, x: 0, y: 0, damage: 1 })!;
    expect(hitTest(thorn, { x: R.volleySize - 0.5, y: 0, r: 0.01 })).toBe(true);
    expect(hitTest(thorn, { x: R.volleySize + 0.5, y: 0, r: 0.01 })).toBe(false);
  });
});

/** Run Rose alone for `seconds` at `level`, still soul kept alive; returns the measurements. */
function measure(level: number, seconds = 40) {
  const w = new World(640, 369);
  const rose = new Rose(w);
  rose.setLevel(level);
  const phases: string[] = [];
  w.bus.on('rosePhaseChanged', (e) => phases.push(`${e.phase}@${(Math.round(w.time * 10) / 10).toFixed(1)}`));
  const started: string[] = [];
  w.bus.on('attackStarted', (e) => started.push(e.attack));
  // Bullet -> its age when last seen: a pool slot freed and reused within one step is a new bullet
  // (its age went back down), so it is counted again.
  const seen = new Map<Bullet, number>();
  const entered = new Set<Bullet>();
  const spawned = { volley: 0, vine: 0, bloomRose: 0, bloomThorn: 0 };
  const arrived = { volley: 0, vine: 0, bloomThorn: 0 };
  let narrowest = Infinity;
  let maxVines = 0;
  let onScreenSpawns = 0, bandSpawns = 0, nonWhite = 0, roseInBox = 0, wrongPhase = 0;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    rose.tick(STEP);
    const fresh: Bullet[] = [];
    for (const b of w.pool.all) {
      if (!b.active) continue;
      const prev = seen.get(b);
      seen.set(b, b.age);
      if (prev !== undefined && b.age >= prev) continue;
      entered.delete(b);
      fresh.push(b);
      if (!b.decor && b.kind !== 'white') nonWhite++;
      if (isVine(b)) spawned.vine++;
      else if (isRose(b)) spawned.bloomRose++;
      else if (isVolley(b)) spawned.volley++;
      else if (isThorn(b)) spawned.bloomThorn++;
      const a = bulletWorldAabb(w.box, b);
      const on = a.x1 > 0 && a.x0 < SCREEN_WIDTH && a.y1 > 0 && a.y0 < SCREEN_HEIGHT;
      // The opening rows are pre-fired already part way in (as the old Prism volley: Character.preFire).
      const opening = isVolley(b) && i === 0;
      if (on && !opening && !isRose(b) && !(isThorn(b) && b.flags === 1)) onScreenSpawns++;
      if (aabbInBand({ x0: Math.max(a.x0, 0), x1: Math.min(a.x1, SCREEN_WIDTH), y0: Math.max(a.y0, 0), y1: Math.min(a.y1, SCREEN_HEIGHT) }) && on) bandSpawns++;
      if (isRose(b) && Math.abs(b.x) < w.box.halfWidth + R.roseSize && Math.abs(b.y) < w.box.halfHeight + R.roseSize) roseInBox++;
    }
    // Narrowest opening of each lash, measured on the spawned vines against the box's walls.
    const lash = fresh.filter(isVine);
    if (lash.length) {
      const horiz = lash[0]!.vy === 0; // moving sideways: lanes spread along y
      const len = horiz ? w.box.height : w.box.width;
      const vw = vineWidth(R);
      const us = lash.map((b) => (horiz ? b.y : b.x)).sort((a, b) => a - b);
      const edges = [-len / 2, ...us.flatMap((u) => [u - vw / 2, u + vw / 2]), len / 2];
      for (let k = 0; k < edges.length; k += 2) narrowest = Math.min(narrowest, edges[k + 1]! - edges[k]!);
    }
    w.step(still, STEP);
    w.soul.iframes = 1;
    // Vines with any part inside the box (the next lash may already be growing in off screen).
    const inBox = (b: Bullet) => {
      let hit = false;
      bulletPrimitives(b, (q) => {
        const c = q.kind === 'rect' ? q.r : q.kind === 'circle' ? q.c : { x: (q.t.ax + q.t.bx + q.t.cx) / 3, y: (q.t.ay + q.t.by + q.t.cy) / 3 };
        if (Math.abs(c.x) < w.box.halfWidth && Math.abs(c.y) < w.box.halfHeight) hit = true;
        return hit;
      });
      return hit;
    };
    maxVines = Math.max(maxVines, w.pool.all.filter((b) => b.active && isVine(b) && inBox(b)).length);
    for (const b of w.pool.all) {
      if (!b.active || b.decor || entered.has(b) || !inside(w, b)) continue;
      entered.add(b);
      const kind = isVine(b) ? 'vine' : isVolley(b) ? 'volley' : 'bloomThorn';
      arrived[kind]++;
      const want = kind === 'bloomThorn' ? 'bloom' : kind;
      // A vine enters on the beat; its stem stays while it holds (checked at entry only).
      // Bloom thorns spawn inside the pool's update (from the rose's hook); ones in later pool slots also
      // move that same step, so a ring can arrive one step early (quantised to the step, like shines).
      const late = kind === 'bloomThorn' ? [STEP, 2 * STEP] : [STEP];
      if (![-2 * STEP, 0, ...late].some((d) => rose.phaseAt(w.time + d).phase === want)) wrongPhase++;
    }
    for (const b of [...seen.keys()]) if (!b.active) { seen.delete(b); entered.delete(b); }
  }
  return { w, maxVines, phases, spawned, arrived, narrowest, onScreenSpawns, bandSpawns, nonWhite, roseInBox, wrongPhase, started, dropped: w.pool.dropped };
}

describe('Rose behaviour (40 s at levels 1, 10, 20)', () => {
  it('phase timelines, counts per attack, narrowest vine gap; all white, off screen (blooms just outside), never in a band, on phase', () => {
    for (const level of [1, 10, 20]) {
      const m = measure(level);
      // eslint-disable-next-line no-console
      console.log(`Rose L${level}: ${m.phases.join(' ')} | spawned ${JSON.stringify(m.spawned)} | entered the box ${JSON.stringify(m.arrived)} | max vines in the box at once ${m.maxVines} | narrowest vine gap ${Number.isFinite(m.narrowest) ? m.narrowest.toFixed(1) : '-'} px (soul diameter ${SOUL_RADIUS * 2}) | wrong phase ${m.wrongPhase}`);
      // Only unlocked attacks, one phase each: never an empty phase.
      const want = level === 1
        ? ['volley@0.0', 'breather@8.0', 'volley@9.0', 'breather@17.0', 'volley@18.0']
        : level === 10
          ? ['volley@0.0', 'breather@8.0', 'vine@9.0', 'breather@17.0', 'volley@18.0']
          : ['volley@0.0', 'breather@8.0', 'vine@9.0', 'breather@17.0', 'bloom@18.0', 'breather@26.0', 'volley@27.0'];
      expect(m.phases.every((ph) => !ph.startsWith('rest'))).toBe(true);
      expect(m.phases.slice(0, want.length)).toEqual(want);
      expect(m.nonWhite).toBe(0);
      expect(m.onScreenSpawns).toBe(0);
      expect(m.bandSpawns).toBe(0);
      expect(m.roseInBox).toBe(0);
      expect(m.wrongPhase).toBe(0);
      expect(m.dropped).toBe(0);
      expect(m.spawned.volley).toBeGreaterThan(0);
      if (level >= 6) {
        expect(m.spawned.vine).toBeGreaterThan(0);
        expect(m.arrived.vine).toBe(m.spawned.vine);
        expect(m.narrowest).toBeGreaterThanOrEqual(R.vineMinGap - 1e-6);
        expect(m.narrowest).toBeGreaterThan(SOUL_RADIUS * 2);
        // One lash at a time: its vines are gone before the next lash spawns (lashes never cross).
        expect(m.maxVines).toBeLessThanOrEqual(resolveLevel(roseConfig, level).attacks.vine!.count!);
      } else expect(m.spawned.vine).toBe(0);
      if (level >= 15) {
        expect(m.spawned.bloomRose).toBeGreaterThan(0);
        expect(m.arrived.bloomThorn).toBeGreaterThan(0);
        expect(m.spawned.bloomThorn).toBe(m.spawned.bloomRose * resolveLevel(roseConfig, level).attacks.bloom!.ring!);
      } else expect(m.spawned.bloomRose).toBe(0);
      expect(new Set(m.started)).toEqual(new Set(Object.keys(resolveLevel(roseConfig, level).attacks)));
    }
  });
  it('the first thorn row reaches the box about 1 s in (pre-fired, as the old Prism volley)', () => {
    for (const level of [1, 10, 20]) {
      const w = new World(640, 369);
      const rose = new Rose(w);
      rose.setLevel(level);
      let first = -1;
      for (let i = 0; i < 60 * 5 && first < 0; i++) {
        rose.tick(STEP);
        w.step(still, STEP);
        w.soul.iframes = 1;
        if (w.pool.all.some((b) => b.active && inside(w, b))) first = w.time;
      }
      expect(first).toBeGreaterThan(0.9);
      expect(first).toBeLessThan(1.1);
    }
  });
  it('thorn volleys keep the old constant spacing with one safe gap', () => {
    for (const level of [1, 10, 20]) {
      const w = new World(640, 369);
      const rose = new Rose(w);
      rose.setLevel(level);
      let row: Bullet[] = [];
      const opening = new Set<Bullet>();
      for (let i = 0; i < 60 * 12 && row.length === 0; i++) {
        rose.tick(STEP);
        if (i === 0) w.pool.all.forEach((b) => b.active && opening.add(b));
        row = w.pool.all.filter((b) => b.active && isVolley(b) && b.age === 0 && !opening.has(b));
      }
      row = row.filter((b) => Math.sign(b.vx) === Math.sign(row[0]!.vx) && Math.sign(b.vy) === Math.sign(row[0]!.vy));
      const r = resolveLevel(roseConfig, level).attacks.volley!;
      const horizontal = row[0]!.vx === 0;
      const along = row.map((b) => (horizontal ? b.x : b.y)).sort((a, b) => a - b);
      const slots = Math.floor((horizontal ? w.box.width : w.box.height) / R.volleySpacing);
      expect(row.length).toBe(slots - r.gapSize!);
      const gaps = along.slice(1).map((v, i) => +(v - along[i]!).toFixed(6));
      expect(gaps.filter((g) => g !== R.volleySpacing)).toEqual(gaps.some((g) => g !== R.volleySpacing) ? [+(R.volleySpacing * (r.gapSize! + 1)).toFixed(6)] : []);
    }
  });
  it('blooms are harmless decor; the vine stops, holds and pulls back out', () => {
    const w = new World(640, 369);
    const rose = new Rose(w);
    rose.setLevel(20);
    const p = resolveLevel(roseConfig, 20).attacks.bloom!;
    const bloom = rose.bloom(p, 'top')!;
    expect(bloom.decor).toBe(true);
    w.soul.pos.x = bloom.x;
    w.soul.pos.y = bloom.y;
    w.step(still, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp);
    // A lash at L20: every vine reaches the far wall, holds, then leaves the screen.
    const w2 = new World(640, 369);
    const r2 = new Rose(w2);
    r2.setLevel(20);
    let maxReach = 0;
    let vines = 0;
    for (let i = 0; i < 60 * 20; i++) {
      r2.tick(STEP);
      w2.step(still, STEP);
      w2.soul.iframes = 1;
      for (const b of w2.pool.all) if (b.active && isVine(b)) { vines++; maxReach = Math.max(maxReach, Math.abs(b.vx) > 0 ? Math.abs(b.x) : Math.abs(b.y)); }
    }
    expect(vines).toBeGreaterThan(0);
    expect(w2.pool.all.filter((b) => b.active && isVine(b)).length).toBeLessThanOrEqual(6);
  });
  it('level 0 spawns nothing; level 20 stays bounded for 60 s', () => {
    const w = new World(0, 0);
    const r = new Rose(w);
    r.setLevel(0);
    for (let i = 0; i < 60 * 20; i++) { r.tick(STEP); w.step(still, STEP); }
    expect(w.pool.activeCount).toBe(0);
    const m = measure(20, 60);
    expect(m.dropped).toBe(0);
  });
});
