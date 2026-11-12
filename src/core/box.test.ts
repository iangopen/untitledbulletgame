import { describe, expect, it } from 'vitest';
import { Box } from './Box';
import { World } from './World';
import { STEP } from './Clock';
import { BOX_MIN_HEIGHT, BOX_MIN_WIDTH, SOUL_RADIUS, SOUL_SPEED, IFRAME_DURATION } from '../tuning';

const still = { dx: 0, dy: 0, slow: false };
const run = (b: Box, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) b.step(STEP);
};

describe('Box geometry under rotation', () => {
  for (const rot of [0, Math.PI / 6, Math.PI / 2, Math.PI, -2.2]) {
    it(`toLocal/toWorld round-trip at ${rot.toFixed(2)} rad`, () => {
      const b = new Box(320, 240, 300, 220, rot);
      for (const p of [{ x: 0, y: 0 }, { x: 150, y: -110 }, { x: -37.5, y: 12.25 }]) {
        const back = b.toLocal(b.toWorld(p));
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    });
  }
  it('90 degrees maps local +x to world +y', () => {
    const b = new Box(100, 100, 50, 50, Math.PI / 2);
    const w = b.toWorld({ x: 10, y: 0 });
    expect(w.x).toBeCloseTo(100);
    expect(w.y).toBeCloseTo(110);
  });
  it('dirToLocal undoes the rotation for directions', () => {
    const b = new Box(0, 0, 50, 50, Math.PI / 2);
    const d = b.dirToLocal({ x: 0, y: -1 }); // screen up
    expect(d.x).toBeCloseTo(-1);
    expect(d.y).toBeCloseTo(0);
  });
});

describe('Box tweens', () => {
  it('reaches targets after the duration, on the fixed step only', () => {
    const b = new Box(0, 0, 300, 200);
    b.resizeTo(200, 100, 1);
    b.moveTo(40, -20, 0.5);
    b.rotateTo(Math.PI / 4, 2);
    expect(b.width).toBe(300); // nothing until step()
    run(b, 0.5);
    expect(b.x).toBeCloseTo(40);
    expect(b.y).toBeCloseTo(-20);
    expect(b.width).toBeGreaterThan(200);
    run(b, 1.5);
    expect([b.width, b.height]).toEqual([200, 100]);
    expect(b.rotation).toBeCloseTo(Math.PI / 4);
    expect(b.moving).toBe(false);
  });
  it('different properties run at the same time', () => {
    const b = new Box(0, 0, 300, 200);
    b.resizeTo(100, 100, 1, 'linear');
    b.rotateTo(1, 1, 'linear');
    run(b, 0.5);
    expect(b.width).toBeCloseTo(200);
    expect(b.rotation).toBeCloseTo(0.5);
  });
  it('a new request for the same property replaces the running one from its current value', () => {
    const b = new Box(0, 0, 300, 200);
    b.rotateTo(Math.PI, 1, 'linear');
    run(b, 0.5);
    const mid = b.rotation;
    expect(mid).toBeCloseTo(Math.PI / 2);
    b.rotateTo(0, 1, 'linear');
    b.step(STEP);
    // continues from where it was, no jump back to the original start
    expect(b.rotation).toBeCloseTo(mid - mid * STEP, 6);
    run(b, 1);
    expect(b.rotation).toBeCloseTo(0);
  });
  it('rotateBy accumulates onto a running rotation target', () => {
    const b = new Box(0, 0, 300, 200);
    b.rotateBy(Math.PI / 2, 1);
    b.rotateBy(Math.PI / 2, 1);
    run(b, 1);
    expect(b.rotation).toBeCloseTo(Math.PI);
  });
  it('clamps every resize to the minimum size', () => {
    const b = new Box(0, 0, 300, 200);
    b.resizeTo(5, -50, 0);
    expect([b.width, b.height]).toEqual([BOX_MIN_WIDTH, BOX_MIN_HEIGHT]);
    b.reset();
    b.squeezeWall('left', 1000, 0.2);
    run(b, 0.3);
    expect(b.width).toBe(BOX_MIN_WIDTH);
    expect(BOX_MIN_WIDTH).toBeGreaterThan(SOUL_RADIUS * 4);
  });
  it('squeezing a wall keeps the opposite wall fixed in the world, even rotated', () => {
    const b = new Box(100, 50, 300, 200, 0.6);
    const rightBefore = b.toWorld({ x: b.halfWidth, y: 0 });
    b.squeezeWall('left', 120, 0.4);
    run(b, 0.5);
    expect(b.width).toBeCloseTo(180);
    const rightAfter = b.toWorld({ x: b.halfWidth, y: 0 });
    expect(rightAfter.x).toBeCloseTo(rightBefore.x, 6);
    expect(rightAfter.y).toBeCloseTo(rightBefore.y, 6);
  });
  it('reset restores the default geometry, safe walls and no motion', () => {
    const b = new Box(10, 20, 300, 200);
    b.resizeTo(100, 100, 2);
    b.rotateTo(1, 2);
    b.setWall('top', { damaging: true, damage: 9 });
    run(b, 0.3);
    b.reset();
    expect(b.state).toEqual({ x: 10, y: 20, width: 300, height: 200, rotation: 0 });
    expect(b.walls.top.damaging).toBe(false);
    expect(b.moving).toBe(false);
  });
  it('emits events on requests and wall changes', () => {
    const w = new World(0, 0);
    const got: string[] = [];
    for (const e of ['boxResized', 'boxMoved', 'boxRotated', 'wallStateChanged'] as const) w.bus.on(e, () => got.push(e));
    w.box.resizeTo(200, 200, 1);
    w.box.moveTo(5, 5, 1);
    w.box.rotateTo(1, 1);
    w.box.setWall('left', { damaging: true, damage: 3 });
    expect(got).toEqual(['boxResized', 'boxMoved', 'boxRotated', 'wallStateChanged']);
  });
});

describe('Soul and contents in a moving box', () => {
  it('a squeezing wall pushes the soul inward; it never leaves the box', () => {
    const w = new World(0, 0);
    w.soul.pos.x = -140; // near the left wall (hw = 150)
    w.box.squeezeWall('left', 100, 0.5);
    let maxOutside = -Infinity;
    for (let i = 0; i < 60; i++) {
      w.step(still, STEP);
      maxOutside = Math.max(maxOutside, w.soul.hitRadius - w.box.distanceToWall(w.soul.pos, 'left'));
    }
    expect(maxOutside).toBeLessThanOrEqual(1e-9);
    expect(w.box.distanceToWall(w.soul.pos, 'left')).toBeCloseTo(SOUL_RADIUS);
  });
  it('fast squeeze (whole width in one step) still keeps the soul inside', () => {
    const w = new World(0, 0);
    w.soul.pos.x = -140;
    w.soul.pos.y = 100;
    w.box.squeezeWall('left', 1000, 0); // instant, clamped to min width
    w.box.squeezeWall('top', 1000, 0);
    w.step(still, STEP);
    for (const wall of ['left', 'right', 'top', 'bottom'] as const) {
      expect(w.box.distanceToWall(w.soul.pos, wall)).toBeGreaterThanOrEqual(SOUL_RADIUS - 1e-9);
    }
  });
  it('a squeeze does not drag things the wall has not reached (world-fixed contents)', () => {
    const w = new World(640, 360);
    w.soul.pos.x = 100; // near the right wall, far from the moving left wall
    const before = w.box.toWorld(w.soul.pos);
    const bullet = w.pool.spawn({ shape: 'circle', x: 50, y: -80, a: 3, damage: 1, noPop: true })!;
    const bBefore = w.box.toWorld(bullet);
    w.box.squeezeWall('left', 80, 0.3);
    for (let i = 0; i < 30; i++) w.step(still, STEP);
    const after = w.box.toWorld(w.soul.pos);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    const bAfter = w.box.toWorld(bullet);
    expect(bAfter.x).toBeCloseTo(bBefore.x, 6);
  });
  it('the soul rides with the box when it moves and rotates (box-local default)', () => {
    const w = new World(0, 0);
    w.soul.pos.x = 50;
    w.box.moveTo(30, 0, 0);
    w.box.rotateTo(Math.PI / 2, 0);
    w.step(still, STEP);
    const p = w.box.toWorld(w.soul.pos);
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(50);
  });
  it('controls stay screen-relative when the box is rotated', () => {
    const w = new World(0, 0);
    w.box.rotateTo(Math.PI / 2, 0);
    const before = w.box.toWorld(w.soul.pos);
    for (let i = 0; i < 10; i++) w.step({ dx: 0, dy: -1, slow: false }, STEP); // screen up
    const after = w.box.toWorld(w.soul.pos);
    expect(after.y).toBeLessThan(before.y - 20);
    expect(after.x).toBeCloseTo(before.x, 6);
  });
});

describe('Damaging walls', () => {
  it('deal damage once on contact, then i-frames block; KR goes to the pool', () => {
    const w = new World(0, 0);
    const hits: string[] = [];
    w.bus.on('wallHit', (e) => hits.push(e.wall));
    w.box.setWall('left', { damaging: true, damage: 7, type: 'normal' });
    w.soul.pos.x = -1000; // clamp presses it against the left wall
    for (let i = 0; i < 30; i++) w.step({ dx: -1, dy: 0, slow: false }, STEP);
    expect(w.soul.hp).toBe(93);
    expect(hits).toEqual(['left']);
    for (let i = 0; i < Math.round(IFRAME_DURATION / STEP) + 2; i++) w.step({ dx: -1, dy: 0, slow: false }, STEP);
    expect(w.soul.hp).toBe(86); // hit again only after i-frames ended
    const k = new World(0, 0);
    k.box.setWall('top', { damaging: true, damage: 12, type: 'kr' });
    k.soul.pos.y = -1000;
    k.step(still, STEP);
    expect(k.soul.kr).toBeGreaterThan(11);
  });
  it('safe walls and a soul not touching do nothing', () => {
    const w = new World(0, 0);
    w.box.setWall('right', { damaging: true, damage: 7 });
    w.soul.pos.x = w.box.halfWidth - w.soul.hitRadius - 1; // 1 px away
    w.step(still, STEP);
    expect(w.soul.hp).toBe(100);
    w.soul.pos.x = 1000; // pressed against
    w.step(still, STEP);
    expect(w.soul.hp).toBe(93);
  });
});

describe('Bullet wall hooks in a moving box', () => {
  it('fire at the real wall position when the box is rotated and resized', () => {
    const w = new World(0, 0);
    w.box.rotateTo(Math.PI / 6, 0);
    w.box.resizeTo(200, 150, 0);
    const hits: { x: number; y: number }[] = [];
    w.pool.spawn({ shape: 'circle', x: 0, y: 0, vx: 120, a: 3, damage: 0, onWall: (b) => (hits.push({ x: b.x, y: b.y }), 'die') });
    for (let i = 0; i < 120; i++) w.step(still, STEP);
    expect(hits).toHaveLength(1);
    // crossed the right wall (local x just past hw = 100), regardless of rotation
    expect(hits[0]!.x).toBeGreaterThan(100);
    expect(hits[0]!.x).toBeLessThan(100 + 120 * STEP + 1e-9);
  });
});

describe('Box.scaleTo (toss)', () => {
  it('scales size about the center; the soul keeps its relative spot, scales its radius and stays inside', () => {
    const w = new World(640, 369);
    w.soul.pos.x = 200;
    w.soul.pos.y = -150;
    const rel = { x: w.soul.pos.x / w.box.halfWidth, y: w.soul.pos.y / w.box.halfHeight };
    w.box.scaleTo(0.5, 0.4, 'quadOut');
    for (let i = 0; i < 30; i++) {
      w.step({ dx: 0, dy: 0, slow: false }, STEP);
      expect(Math.abs(w.soul.pos.x)).toBeLessThanOrEqual(w.box.halfWidth - w.soul.hitRadius + 1e-9);
      expect(Math.abs(w.soul.pos.y)).toBeLessThanOrEqual(w.box.halfHeight - w.soul.hitRadius + 1e-9);
    }
    expect(w.box.scale).toBeCloseTo(0.5, 9);
    expect(w.box.width).toBeCloseTo(225, 9);
    expect(w.box.height).toBeCloseTo(165, 9);
    expect(w.box.x).toBe(640);
    expect(w.soul.hitRadius).toBeCloseTo(SOUL_RADIUS * 0.5, 9);
    expect(w.soul.pos.x / w.box.halfWidth).toBeCloseTo(rel.x, 9);
    expect(w.soul.pos.y / w.box.halfHeight).toBeCloseTo(rel.y, 9);
    // Movement scales too: one second right covers the same fraction of the box.
    w.soul.pos.x = 0;
    for (let i = 0; i < 30; i++) w.step({ dx: 1, dy: 0, slow: false }, STEP);
    expect(w.soul.pos.x).toBeCloseTo(SOUL_SPEED * 0.5 * 0.5, 6);
    w.box.scaleTo(1, 0.3);
    for (let i = 0; i < 20; i++) w.step({ dx: 0, dy: 0, slow: false }, STEP);
    expect(w.box.width).toBeCloseTo(450, 9);
    expect(w.soul.hitRadius).toBeCloseTo(SOUL_RADIUS, 9);
  });

  it('hitboxes: the scaled soul is hit by a bullet at its scaled radius, not its full one', () => {
    const w = new World(640, 369);
    w.box.scaleTo(0.5);
    w.step({ dx: 0, dy: 0, slow: false }, STEP);
    const r = SOUL_RADIUS * 0.5;
    // A still bullet just outside the scaled radius misses; just inside hits.
    const miss = w.pool.spawn({ shape: 'circle', a: 5, x: r + 5 + 0.5, y: 0, damage: 10, noPop: true })!;
    w.step({ dx: 0, dy: 0, slow: false }, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp);
    miss.x = r + 5 - 0.5;
    w.step({ dx: 0, dy: 0, slow: false }, STEP);
    expect(w.soul.hp).toBe(w.soul.maxHp - 10);
  });

  it('pushes a soul at the wall inward as it shrinks (wall push), with damaging walls still touching', () => {
    const w = new World(640, 369);
    w.box.setWall('right', { damaging: true, damage: 5 });
    w.soul.pos.x = 300;
    w.box.scaleTo(0.4, 0.2);
    for (let i = 0; i < 20; i++) w.step({ dx: 1, dy: 0, slow: false }, STEP);
    expect(w.soul.pos.x).toBeCloseTo(w.box.halfWidth - w.soul.hitRadius, 9);
    expect(w.soul.hp).toBeLessThan(w.soul.maxHp);
  });

  it('bullets stay world-fixed (position and size) while the box scales and spins', () => {
    const w = new World(640, 369);
    const b = w.pool.spawn({ shape: 'circle', a: 7, x: -320, y: 40, damage: 1, noPop: true })!;
    const p0 = w.box.toWorld(b);
    w.box.scaleTo(0.5, 0.3);
    w.box.rotateTo(2 * Math.PI, 0.5);
    for (let i = 0; i < 40; i++) w.step({ dx: 0, dy: 0, slow: false }, STEP);
    const p1 = w.box.toWorld(b);
    expect(p1.x).toBeCloseTo(p0.x, 6);
    expect(p1.y).toBeCloseTo(p0.y, 6);
    expect(b.a).toBe(7);
    w.box.normalizeRotation();
    expect(w.box.rotation).toBeCloseTo(0, 9);
  });
});
