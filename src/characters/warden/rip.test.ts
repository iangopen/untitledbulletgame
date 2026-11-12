import { describe, expect, it } from 'vitest';
import { World } from '../../core/World';
import type { Box } from '../../core/Box';
import { STEP } from '../../core/Clock';
import { Warden } from './Warden';
import { Director } from '../../director/Director';
import { TimerMode } from '../../director/modes/TimerMode';
import { aabbInBand, bulletWorldAabb, PLAY_BOTTOM, PLAY_TOP, rotatedHalfExtents } from '../../combat/bands';
import { bulletPrimitives } from '../../combat/composite';
import { rectCorners, type Bullet } from '../../combat/Bullet';
import { VIEW } from '../../render/theme';
import { BOX_MIN_HEIGHT, BOX_MIN_WIDTH } from '../../tuning';
import type { MoveInput } from '../../core/Soul';

const STILL: MoveInput = { dx: 0, dy: 0, slow: false };

/** Whether the soul's whole circle is inside at least one box (world space). */
function soulInsideSomeBox(w: World): boolean {
  const p = w.box.toWorld(w.soul.pos);
  const r = w.soul.hitRadius - 1e-6;
  return w.boxes.some((b) => {
    const l = b.toLocal(p);
    return Math.abs(l.x) <= b.halfWidth - r && Math.abs(l.y) <= b.halfHeight - r;
  });
}

function outlineOk(b: Box): boolean {
  const e = rotatedHalfExtents(b.width, b.height, b.rotation);
  return b.x - e.hx >= 0 && b.x + e.hx <= VIEW.width && b.y - e.hy >= PLAY_TOP && b.y + e.hy <= PLAY_BOTTOM;
}

/** Whether any corner/point of a decor bullet's parts lies strictly inside any box. */
function decorInsideABox(w: World, b: Bullet): boolean {
  const pts: { x: number; y: number }[] = [];
  bulletPrimitives(b, (p) => {
    if (p.kind === 'rect') for (const q of rectCorners(p.r, [0, 1, 2, 3].map(() => ({ x: 0, y: 0 })))) pts.push({ ...q });
    else if (p.kind === 'tri') pts.push({ x: p.t.ax, y: p.t.ay }, { x: p.t.bx, y: p.t.by }, { x: p.t.cx, y: p.t.cy });
  });
  return pts.some((q) => {
    const wp = w.box.toWorld(q);
    return w.boxes.some((bx) => {
      const l = bx.toLocal(wp);
      return Math.abs(l.x) < bx.halfWidth - 0.01 && Math.abs(l.y) < bx.halfHeight - 0.01;
    });
  });
}

describe('splitting and merging boxes (World)', () => {
  it('the soul goes to the half its center was in; on the split line it goes left and is pushed fully inside', () => {
    for (const [x, want] of [[-50, 0], [50, 1], [0, 0], [-210, 0], [210, 1]] as const) {
      const w = new World(640, 369);
      w.soul.pos.x = x;
      const before = w.box.toWorld(w.soul.pos);
      const events: unknown[] = [];
      w.bus.on('boxSplit', (e) => events.push(e));
      const halves = w.splitBox()!;
      expect(w.boxes).toHaveLength(2);
      expect(w.box).toBe(halves[want]);
      expect(halves[0].width).toBe(225);
      expect(halves[0].width).toBeGreaterThanOrEqual(BOX_MIN_WIDTH);
      expect(halves[0].height).toBeGreaterThanOrEqual(BOX_MIN_HEIGHT);
      expect(events).toHaveLength(1);
      expect(soulInsideSomeBox(w)).toBe(true);
      const after = w.box.toWorld(w.soul.pos);
      // Off the split line the soul keeps its world position exactly; on it, the clamp moves it 9 px in.
      if (x !== 0) {
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      } else expect(before.x - after.x).toBeCloseTo(w.soul.hitRadius, 9);
    }
  });

  it('bullets keep their world positions and headings through a split and a merge', () => {
    const w = new World(640, 369);
    const b = w.pool.spawn({ shape: 'circle', a: 5, x: 300, y: 100, vx: -50, vy: 20, damage: 1, noPop: true })!;
    const p0 = w.box.toWorld(b);
    w.soul.pos.x = 100; // right half
    w.splitBox();
    const p1 = w.box.toWorld(b);
    expect(p1.x).toBeCloseTo(p0.x, 9);
    expect(p1.y).toBeCloseTo(p0.y, 9);
    w.mergeBoxes();
    const p2 = w.box.toWorld(b);
    expect(p2.x).toBeCloseTo(p0.x, 9);
    expect(w.boxes).toHaveLength(1);
    expect(w.box.width).toBe(450);
  });

  it('the soul is never outside every box through a rip, a pull, a fast merge and a re-center (at the split line and pressed on walls)', () => {
    const cases: { x: number; dx: number; which: 0 | 1; mergeTime: number }[] = [
      { x: 0, dx: 1, which: 0, mergeTime: 0.3 }, // on the split line, pushing right (into the gap)
      { x: 0, dx: -1, which: 1, mergeTime: 0.02 }, // on the line, very fast merge from the right
      { x: -20, dx: 1, which: 0, mergeTime: 0.02 }, // in the punched (left) box, pressed on its inner wall
      { x: 20, dx: -1, which: 0, mergeTime: 0.02 }, // in the static box, pressed toward the arriving box
      { x: 200, dx: 1, which: 1, mergeTime: 0.0 }, // instant merge, pressed on the outer wall
    ];
    for (const c of cases) {
      const w = new World(640, 369);
      w.soul.pos.x = c.x;
      const input: MoveInput = { dx: c.dx, dy: 0, slow: false };
      const [L, R] = w.splitBox()!;
      L.moveTo(L.x - 80, L.y, 0.35);
      R.moveTo(R.x + 80, R.y, 0.35);
      for (let i = 0; i < 40; i++) {
        w.step(input, STEP);
        expect(soulInsideSomeBox(w)).toBe(true);
      }
      const punched = c.which === 0 ? L : R;
      const other = c.which === 0 ? R : L;
      const d = Math.abs(punched.toLocal(other).x) - punched.halfWidth - other.halfWidth;
      punched.moveTo(punched.x + Math.sign(other.x - punched.x) * d, punched.y, c.mergeTime, 'quadIn');
      for (let i = 0; i < 40; i++) {
        w.step(input, STEP);
        expect(soulInsideSomeBox(w)).toBe(true);
        if (!punched.moving && w.boxes.length === 2) w.mergeBoxes();
      }
      expect(w.boxes).toHaveLength(1);
      expect(w.box.width).toBeCloseTo(450, 9);
      w.box.moveTo(w.home.x, w.home.y, 0.1);
      for (let i = 0; i < 20; i++) {
        w.step(input, STEP);
        expect(soulInsideSomeBox(w)).toBe(true);
      }
      expect(w.box.x).toBeCloseTo(w.home.x, 9);
    }
  });

  it('wall hooks fire for the box a bullet actually crosses (the other half too), with die and bounce', () => {
    const w = new World(640, 369);
    w.soul.pos.x = -100; // soul in the left half
    const [L, R] = w.splitBox()!;
    R.moveTo(R.x + 60, R.y, 0);
    w.step(STILL, STEP);
    // A bullet inside the right (other) box, heading out of its right wall.
    const start = R.toWorld({ x: R.halfWidth - 2, y: 0 });
    const sl = L.toLocal(start);
    const calls: { wall: string; box: Box | undefined }[] = [];
    const b = w.pool.spawn({ shape: 'circle', a: 3, x: sl.x, y: sl.y, vx: 300, vy: 0, damage: 1, noPop: true, onWall: (_b, wall, _c, box) => (calls.push({ wall, box }), 'die') })!;
    for (let i = 0; i < 5; i++) w.step(STILL, STEP);
    expect(calls).toEqual([{ wall: 'right', box: R }]);
    expect(b.active).toBe(false);
    // Bounce off the other box's top wall: comes back down inside it.
    const t0 = L.toLocal(R.toWorld({ x: 0, y: -R.halfHeight + 2 }));
    const c = w.pool.spawn({ shape: 'circle', a: 3, x: t0.x, y: t0.y, vx: 0, vy: -300, damage: 1, noPop: true, onWall: () => 'bounce' })!;
    for (let i = 0; i < 3; i++) w.step(STILL, STEP);
    const inR = R.toLocal(L.toWorld(c));
    expect(Math.abs(inR.y)).toBeLessThanOrEqual(R.halfHeight);
    expect(c.vy).toBeGreaterThan(0);
    // The soul's own box still fires hooks with no box argument.
    const own: (Box | undefined)[] = [];
    w.pool.spawn({ shape: 'circle', a: 3, x: -L.halfWidth + 2, y: 0, vx: -300, vy: 0, damage: 1, noPop: true, onWall: (_b, _w, _c, box) => (own.push(box), 'pass') });
    for (let i = 0; i < 3; i++) w.step(STILL, STEP);
    expect(own).toEqual([undefined]);
  });

  it('resetBoxes restores one default box', () => {
    const w = new World(640, 369);
    w.splitBox();
    w.resetBoxes();
    expect(w.boxes).toHaveLength(1);
    expect(w.box.state).toEqual(w.home);
  });
});

describe('The Warden rip at level 20', () => {
  it('60 s alone: rips, merges and re-centers; zero damage; every box on screen and clear of the bands; soul always inside a box', () => {
    for (const input of [STILL, { dx: 1, dy: 0.3, slow: false }, { dx: -1, dy: 0, slow: false }]) {
      const w = new World(640, 369);
      const c = new Warden(w, 4);
      c.setLevel(20);
      const sizes = new Set<string>();
      let hp = 0, boxBad = 0, soulOut = 0, decorBand = 0, decorIn = 0, splitSteps = 0;
      let maxPos = { x0: Infinity, x1: -Infinity };
      for (let i = 0; i < 60 * 60; i++) {
        c.tick(STEP);
        const before = w.soul.hp;
        w.step(input, STEP);
        hp += before - w.soul.hp;
        if (w.boxes.length > 1) splitSteps++;
        for (const b of w.boxes) {
          if (!outlineOk(b)) boxBad++;
          sizes.add(`${b.width.toFixed(0)}x${b.height.toFixed(0)}`);
          maxPos = { x0: Math.min(maxPos.x0, b.x - b.halfWidth), x1: Math.max(maxPos.x1, b.x + b.halfWidth) };
        }
        if (!soulInsideSomeBox(w)) soulOut++;
        for (const b of w.pool.all) {
          if (!b.active) continue;
          if (aabbInBand(bulletWorldAabb(w.box, b))) decorBand++;
          if (decorInsideABox(w, b)) decorIn++;
        }
      }
      if (input === STILL) {
        // eslint-disable-next-line no-console
        console.log(`Warden L20 60 s: ${c.ripLog.join(' | ')}\n  rips ${c.stats.rips}, merges ${c.stats.merges}, re-centers ${c.stats.recenters}; split ${(splitSteps / 60).toFixed(1)} s; box sizes ${[...sizes].join(', ')}; box x range ${maxPos.x0.toFixed(0)}-${maxPos.x1.toFixed(0)}; bad box steps ${boxBad}; soul outside every box ${soulOut}; hands/fists in a band ${decorBand}, inside a box ${decorIn}; HP lost ${hp}`);
      }
      expect(c.stats.rips).toBeGreaterThanOrEqual(2);
      expect(c.stats.merges).toBe(c.stats.rips);
      expect(c.stats.recenters).toBe(c.stats.merges);
      expect(hp).toBe(0);
      expect(boxBad).toBe(0);
      expect(soulOut).toBe(0);
      expect(decorBand).toBe(0);
      expect(decorIn).toBe(0);
      expect(w.boxes).toHaveLength(1);
    }
  });

  it('all five at 20 for 60 s: every attack spawned while split or tossed aims at / forms against the soul box; nothing spawns or forms in a band', () => {
    const w = new World(640, 369);
    const d = new Director(w, { rose: 20, prism: 20, mortimer: 20, ulysses: 20, warden: 20, ember: 20, volt: 20, vesper: 20, nightshade: 20 }, new TimerMode(90));
    let tossSpawns = 0, tossTracked = 0, tossSteps = 0;
    const tossBy: Record<string, number> = {};
    const seen = new Set<Bullet>();
    let spawns = 0, spawnInBand = 0, goldInBand = 0, splitSpawns = 0, tracked = 0, splitSteps = 0, soulOut = 0;
    const byOwner: Record<string, number> = {};
    for (let i = 0; i < 60 * 60; i++) {
      d.characters.forEach((c) => c.tick(STEP));
      const split = w.boxes.length > 1;
      const tossed = w.box.scale < 0.999;
      if (tossed) tossSteps++;
      if (split) splitSteps++;
      for (const b of w.pool.all) {
        if (!b.active || b.decor) continue;
        const a = bulletWorldAabb(w.box, b);
        if (!seen.has(b)) {
          seen.add(b);
          spawns++;
          if (aabbInBand(a)) spawnInBand++;
          // Prism's mirror beam (flag 2) follows the path laid by mirrors formed against the soul box
          // (checked in prism.test.ts), so like refraction children it isn't checked for straight-line aim.
          // Rose's bloom rings (flag 1) burst out of a rose formed against the soul box; half fly outward by design.
          const child = (b.owner === 'prism' && (b.gen > 0 || (b.flags & 2) !== 0)) || (b.owner === 'ulysses' && (b.flags & 4) !== 0) || (b.owner === 'rose' && b.flags === 1);
          if (tossed && !child) {
            tossSpawns++;
            if (aimsAtSoulBox(w, b)) {
              tossTracked++;
              tossBy[b.owner] = (tossBy[b.owner] ?? 0) + 1;
            }
          }
          if (split && !child) {
            splitSpawns++;
            if (aimsAtSoulBox(w, b)) {
              tracked++;
              byOwner[b.owner] = (byOwner[b.owner] ?? 0) + 1;
            }
          }
        }
        if (!b.armed && aabbInBand(a)) goldInBand++;
      }
      for (const b of [...seen]) if (!b.active) seen.delete(b);
      w.step(STILL, STEP);
      w.soul.iframes = 1;
      if (!soulInsideSomeBox(w)) soulOut++;
    }
    // eslint-disable-next-line no-console
    console.log(`all five at 20, 60 s: tossed ${(tossSteps / 60).toFixed(1)} s, ${tossSpawns} attack spawns while tossed, ${tossTracked} aimed at / formed against the tossed box (${JSON.stringify(tossBy)}); ${spawns} spawns, ${spawnInBand} in a band, gold in a band ${goldInBand}; split for ${(splitSteps / 60).toFixed(1)} s; ${splitSpawns} attack spawns while split, ${tracked} aimed at / formed against the soul's box (${JSON.stringify(byOwner)}); soul outside every box ${soulOut}`);
    expect(splitSteps).toBeGreaterThan(60 * 4);
    expect(spawnInBand).toBe(0);
    expect(goldInBand).toBe(0);
    expect(splitSpawns).toBeGreaterThan(20);
    expect(tracked).toBe(splitSpawns);
    expect(tossSteps).toBeGreaterThan(60 * 4);
    expect(tossSpawns).toBeGreaterThan(20);
    expect(tossTracked).toBe(tossSpawns);
    expect(soulOut).toBe(0);
  });
});

/** Same test as the displaced-box check: the path (box-local, soul's box) crosses the soul's box, or it forms next to it. */
function aimsAtSoulBox(w: World, b: Bullet): boolean {
  const hw = w.box.halfWidth, hh = w.box.halfHeight;
  // Prism's laser (a long still bar from its emitter): does its axis cross the box?
  if (b.shape === 'rect' && b.owner === 'prism') {
    const c = Math.cos(b.rotation), s = Math.sin(b.rotation);
    for (let t = -b.a; t <= b.a; t += 2) if (Math.abs(b.x + c * t) <= hw && Math.abs(b.y + s * t) <= hh) return true;
    return false;
  }
  if (b.vx === 0 && b.vy === 0) {
    const dx = Math.max(0, Math.abs(b.x) - hw), dy = Math.max(0, Math.abs(b.y) - hh);
    return Math.hypot(dx, dy) < 120;
  }
  // Snowfall and embers sway sideways; test their line with a margin of the sway amplitude.
  const pad = b.owner === 'mortimer' || b.owner === 'ember' ? 60 : 1;
  for (let t = 0; t < 30; t += 0.01) {
    const x = b.x + b.vx * t, y = b.y + b.vy * t;
    if (Math.abs(x) <= hw + pad && Math.abs(y) <= hh + pad) return true;
  }
  return false;
}
