import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { STEP } from '../core/Clock';
import { PROJECTILE_TYPES, damageTypeOf, projectileHurts, type ProjectileType } from './projectile';

const STILL = { dx: 0, dy: 0, slow: false };
const RIGHT = { dx: 1, dy: 0, slow: false };

/** A big stationary bullet of `kind` covering the soul, so contact holds every step. */
function setup(kind: ProjectileType) {
  const w = new World(640, 360);
  w.pool.spawn({ shape: 'circle', x: 0, y: 0, a: 60, damage: 10, kind, noPop: true });
  return w;
}

/** HP lost (normal) plus KR owed after one step with `input`. */
function hurtAfter(w: World, input: typeof STILL): number {
  const before = w.soul.hp + 0;
  const kr0 = w.soul.kr;
  w.step(input, STEP);
  return before - w.soul.hp + (w.soul.kr - kr0);
}

describe('projectile type rules', () => {
  it('rule table: white and kr always, blue only moving, orange only still', () => {
    expect(PROJECTILE_TYPES.map((k) => [k, projectileHurts(k, true), projectileHurts(k, false)])).toEqual([
      ['white', true, true],
      ['blue', true, false],
      ['orange', false, true],
      ['kr', true, true],
    ]);
    expect(damageTypeOf('kr')).toBe('kr');
    expect(damageTypeOf('blue')).toBe('normal');
  });

  for (const kind of PROJECTILE_TYPES) {
    const hurtsMoving = projectileHurts(kind, true);
    const hurtsStill = projectileHurts(kind, false);

    it(`${kind}: ${hurtsStill ? 'hurts' : 'passes'} a still soul, ${hurtsMoving ? 'hurts' : 'passes'} a moving soul`, () => {
      const still = setup(kind);
      expect(hurtAfter(still, STILL) > 0).toBe(hurtsStill);
      const moving = setup(kind);
      expect(hurtAfter(moving, RIGHT) > 0).toBe(hurtsMoving);
    });

    it(`${kind}: decided by the step where the soul starts and stops moving`, () => {
      const w = setup(kind);
      // Still for a few steps (no i-frames from a harmless type), then the step it starts moving.
      for (let i = 0; i < 3; i++) w.step(STILL, STEP);
      w.soul.iframes = 0;
      const hpBefore = w.soul.hp + w.soul.kr * 0;
      const krBefore = w.soul.kr;
      w.step(RIGHT, STEP); // first moving step
      expect(w.soul.moving).toBe(true);
      expect(hpBefore - w.soul.hp + (w.soul.kr - krBefore) > 0).toBe(hurtsMoving);

      for (let i = 0; i < 3; i++) w.step(RIGHT, STEP);
      w.soul.iframes = 0;
      const hp2 = w.soul.hp;
      const kr2 = w.soul.kr;
      w.step(STILL, STEP); // first still step
      expect(w.soul.moving).toBe(false);
      expect(hp2 - w.soul.hp + (w.soul.kr - kr2) > 0).toBe(hurtsStill);
    });
  }

  it('a harmless contact grants no i-frames', () => {
    const w = setup('blue');
    w.step(STILL, STEP);
    expect(w.soul.iframes).toBe(0);
    expect(w.soul.hp).toBe(w.soul.maxHp);
  });

  it('holding a direction into a wall counts as moving (blue hurts, orange passes)', () => {
    for (const [kind, hurts] of [['orange', false], ['blue', true]] as const) {
      const w = new World(640, 360);
      w.soul.pos.x = w.box.halfWidth - w.soul.hitRadius; // already against the right wall
      w.pool.spawn({ shape: 'circle', x: w.soul.pos.x, y: 0, a: 40, damage: 10, kind, noPop: true });
      const x0 = w.soul.pos.x;
      w.step(RIGHT, STEP);
      expect(w.soul.pos.x).toBe(x0); // didn't actually move
      expect(w.soul.moving).toBe(true);
      expect(w.soul.hp < w.soul.maxHp).toBe(hurts);
    }
  });

  it('opposite keys cancel (still), and riding the box is still', () => {
    const w = setup('blue');
    w.step({ dx: 0, dy: 0, slow: true }, STEP);
    expect(w.soul.moving).toBe(false);
    w.box.moveTo(700, 360, 0.2, 'linear');
    for (let i = 0; i < 6; i++) w.step(STILL, STEP);
    expect(w.soul.moving).toBe(false);
    expect(w.soul.hp).toBe(w.soul.maxHp);
  });

  it('a dash counts as moving for its whole duration, even after the key is released', async () => {
    const { Dash } = await import('../abilities/actives/Dash');
    const w = new World(640, 360);
    w.ability = new Dash();
    w.step({ ...RIGHT, ability: true }, STEP);
    expect(w.soul.moving).toBe(true);
    w.step(STILL, STEP);
    expect(w.soul.moving).toBe(true);
    for (let i = 0; i < 20; i++) w.step(STILL, STEP);
    expect(w.soul.moving).toBe(false);
  });

  it('kr goes to the KR pool through Soul.damage', () => {
    const w = setup('kr');
    w.step(STILL, STEP);
    expect(w.soul.kr).toBe(10);
    expect(w.soul.iframes).toBeGreaterThan(0);
  });
});
