import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { STEP } from '../core/Clock';
import { Shield } from './actives/Shield';
import { SlowTime } from './actives/SlowTime';
import { Blink } from './actives/Blink';
import { Dash } from './actives/Dash';
import { ACTIVES, ACTIVE_INFO, PASSIVES, PASSIVE_INFO, equipLoadout, loadLoadout, parseLoadout, saveLoadout, LOADOUT_KEY } from './loadout';
import { Director } from '../director/Director';
import { TimerMode } from '../director/modes/TimerMode';
import { makeForm } from '../combat/composite';
import {
  AFTERGLOW_IFRAMES, BLINK_COOLDOWN, BLINK_DISTANCE, DASH_COOLDOWN, IFRAME_DURATION, MAX_HP, QUICK_CHARGE_COOLDOWN,
  SHIELD_BREAK_IFRAMES, SHIELD_DURATION, SLOW_MULTIPLIER, SLOWTIME_DURATION, SLOWTIME_SCALE, SOUL_SPEED,
  STEADY_SLOW_MULTIPLIER, THICK_SKIN_HP,
} from '../tuning';
import type { ProjectileType } from '../combat/projectile';

const STILL = { dx: 0, dy: 0, slow: false };
const RIGHT = { dx: 1, dy: 0, slow: false };
const press = (i: typeof STILL) => ({ ...i, ability: true });

function withShield() {
  const w = new World(640, 369);
  w.ability = new Shield();
  w.step(press(STILL), STEP);
  expect(w.soul.shielded).toBe(true);
  return w;
}

describe('shield', () => {
  it('absorbs exactly one damaging hit of every projectile type, then breaks', () => {
    for (const kind of ['white', 'blue', 'orange', 'kr'] as ProjectileType[]) {
      const w = withShield();
      // Blue hurts a moving soul, orange a still one: use the input that makes it hurt.
      const input = kind === 'blue' ? RIGHT : STILL;
      w.pool.spawn({ shape: 'circle', a: 300, x: 0, y: 0, damage: 10, kind, noPop: true });
      w.step(input, STEP);
      expect(w.soul.hp, kind).toBe(MAX_HP);
      expect(w.soul.kr, kind).toBe(0);
      expect(w.soul.shielded, kind).toBe(false);
      expect(w.soul.shieldBreaks).toBe(1);
      w.step(STILL, STEP);
      expect((w.ability as Shield).ended).toBe('broke');
      // The break grants short i-frames; after them the next hit lands.
      for (let i = 0; i < Math.ceil(SHIELD_BREAK_IFRAMES / STEP) + 1; i++) w.step(input, STEP);
      expect(w.soul.hp < MAX_HP || w.soul.kr > 0, kind).toBe(true);
    }
  });
  it('absorbs a damaging wall contact', () => {
    const w = withShield();
    w.box.setWall('right', { damaging: true, damage: 5 });
    for (let i = 0; i < 60; i++) w.step(RIGHT, STEP);
    expect(w.soul.shieldBreaks).toBe(1);
  });
  it('ignores harmless objects: gold (pre-active) swords, decor fists, blue on a still soul, orange on a moving one', () => {
    const w = withShield();
    const form = makeForm([{ kind: 'rect', x: 0, y: 0, hw: 30, hh: 30 }]);
    w.pool.spawn({ shape: 'composite', form, a: 0, x: 0, y: 0, damage: 20, armDelay: 5, noPop: true });
    w.pool.spawn({ shape: 'composite', form, a: 0, x: 0, y: 0, damage: 20, decor: true, noPop: true });
    w.pool.spawn({ shape: 'circle', a: 30, x: 0, y: 0, damage: 20, kind: 'blue', noPop: true });
    for (let i = 0; i < 20; i++) w.step(STILL, STEP);
    w.pool.clear();
    w.pool.spawn({ shape: 'circle', a: 30, x: 0, y: 0, damage: 20, kind: 'orange', noPop: true });
    for (let i = 0; i < 20; i++) w.step(RIGHT, STEP);
    expect(w.soul.shielded).toBe(true);
    expect(w.soul.shieldBreaks).toBe(0);
    expect(w.soul.hp).toBe(MAX_HP);
  });
  it('expires unused after SHIELD_DURATION; then hits land', () => {
    const w = withShield();
    for (let i = 0; i < Math.round(SHIELD_DURATION / STEP) + 1; i++) w.step(STILL, STEP);
    expect(w.soul.shielded).toBe(false);
    expect((w.ability as Shield).ended).toBe('expired');
    w.pool.spawn({ shape: 'circle', a: 30, x: 0, y: 0, damage: 10, noPop: true });
    w.step(STILL, STEP);
    expect(w.soul.hp).toBe(MAX_HP - 10);
  });
});

describe('slow time', () => {
  it('scales bullets, box motion and character timers, not the soul; the battle timer counts real time', () => {
    const w = new World(640, 369);
    w.ability = new SlowTime();
    const d = new Director(w, { prism: 20 }, new TimerMode(120));
    const b = w.pool.spawn({ shape: 'circle', a: 2, x: -300, y: -100, vx: 100, damage: 1, noPop: true })!;
    w.box.moveTo(740, 369, 10, 'linear'); // 10 px/s
    const prism = d.characters[0]!;
    d.step(press(STILL), STEP);
    expect(w.timeScale).toBe(SLOWTIME_SCALE);
    const x0 = b.x + 0, bx0 = w.box.x, sx0 = w.soul.pos.x, ct0 = (prism as unknown as { clock: number }).clock;
    w.soul.iframes = 99;
    for (let i = 0; i < 30; i++) d.step(RIGHT, STEP);
    // Half a real second at scale 0.45: the bullet moved 45 px (world frame), the box 4.5 px,
    // Prism's clock 0.45 s (all halved here); the soul walked a full SOUL_SPEED px in box space less the box slide.
    const bw = w.box.toWorld(b);
    expect(bw.x - (bx0 + x0)).toBeCloseTo(0.5 * 100 * SLOWTIME_SCALE, 6);
    expect(w.box.x - bx0).toBeCloseTo(0.5 * 10 * SLOWTIME_SCALE, 6);
    expect((prism as unknown as { clock: number }).clock - ct0).toBeCloseTo(0.5 * SLOWTIME_SCALE, 6);
    expect(w.soul.pos.x - sx0 + (w.box.x - bx0)).toBeCloseTo(0.5 * SOUL_SPEED, 6);
    expect(d.time).toBeCloseTo(31 * STEP, 9); // real time
    // It ends after SLOWTIME_DURATION real seconds.
    for (let i = 0; i < Math.round(SLOWTIME_DURATION / STEP); i++) d.step(STILL, STEP);
    expect(w.timeScale).toBe(1);
  });
  it('a timer run ends after the same real time with or without slow time', () => {
    const ends: number[] = [];
    for (const use of [false, true]) {
      const w = new World(640, 369);
      w.ability = new SlowTime();
      const d = new Director(w, {}, new TimerMode(20));
      let steps = 0;
      while (!d.outcome) {
        d.step(use && steps % 600 === 0 ? press(STILL) : STILL, STEP);
        steps++;
      }
      ends.push(steps);
    }
    expect(ends[0]).toBe(ends[1]);
  });
  it('the fixed step stays deterministic: two identical slowed runs match exactly', () => {
    const run = () => {
      const w = new World(640, 369);
      w.ability = new SlowTime();
      const d = new Director(w, { rose: 20, prism: 20, mortimer: 20, ulysses: 20, warden: 20, ember: 20, volt: 20, vesper: 20, nightshade: 20 }, new TimerMode(120));
      for (let i = 0; i < 60 * 20; i++) {
        w.soul.iframes = 9;
        d.step(i % 300 === 0 ? press(RIGHT) : RIGHT, STEP);
      }
      return w.pool.all.filter((b) => b.active).map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)}`).join(';') + `|${w.box.x}|${w.time}`;
    };
    expect(run()).toBe(run());
  });
});

describe('blink', () => {
  it('teleports BLINK_DISTANCE in the held direction, counts as moving that step, and is spent', () => {
    const w = new World(640, 369);
    w.ability = new Blink();
    w.step(press(RIGHT), STEP);
    expect(w.soul.pos.x).toBeCloseTo(BLINK_DISTANCE, 9);
    expect(w.soul.moving).toBe(true);
    expect(w.ability.remaining).toBeCloseTo(BLINK_COOLDOWN - STEP, 9);
    // A blue bullet on the landing spot hurts that step (blinking counts as moving).
    const w2 = new World(640, 369);
    w2.ability = new Blink();
    w2.pool.spawn({ shape: 'circle', a: 4, x: BLINK_DISTANCE, y: 0, damage: 7, kind: 'blue', noPop: true });
    w2.step(press(RIGHT), STEP);
    expect(w2.soul.hp).toBe(MAX_HP - 7);
  });
  it('does nothing and spends nothing with no direction held', () => {
    const w = new World(640, 369);
    w.ability = new Blink();
    w.step(press(STILL), STEP);
    expect(w.soul.pos.x).toBe(0);
    expect(w.ability.ready).toBe(true);
  });
  it('is clamped inside the soul box: at a wall, in a split half, in a tossed box', () => {
    const w = new World(640, 369);
    w.ability = new Blink();
    w.soul.pos.x = 200;
    w.step(press(RIGHT), STEP);
    expect(w.soul.pos.x).toBeCloseTo(w.box.halfWidth - w.soul.hitRadius, 9);
    // Split: the soul in the left half blinks right, toward the gap: stays in its half.
    const s = new World(640, 369);
    s.ability = new Blink();
    s.soul.pos.x = -60;
    s.splitBox();
    s.step(press(RIGHT), STEP);
    expect(s.soul.pos.x).toBeLessThanOrEqual(s.box.halfWidth - s.soul.hitRadius + 1e-9);
    // Tossed (scaled) box.
    const t = new World(640, 369);
    t.ability = new Blink();
    t.box.scaleTo(0.8);
    t.soul.pos.x = 150;
    t.step(press(RIGHT), STEP);
    expect(t.soul.pos.x).toBeCloseTo(t.box.halfWidth - t.soul.hitRadius, 9);
  });
});

describe('passives (one hook at battle start)', () => {
  it('thick skin +25% max hp, afterglow longer i-frames, quick charge faster cooldown, steady faster slow walk', () => {
    const w0 = new World(640, 369);
    equipLoadout(w0, { active: 'dash', passive: null });
    expect(w0.soul.maxHp).toBe(MAX_HP);
    expect(w0.ability!.cooldown).toBe(DASH_COOLDOWN);

    const a = new World(640, 369);
    equipLoadout(a, { active: 'dash', passive: 'thickSkin' });
    expect(a.soul.maxHp).toBe(MAX_HP * THICK_SKIN_HP);
    expect(a.soul.hp).toBe(MAX_HP * THICK_SKIN_HP);

    const b = new World(640, 369);
    equipLoadout(b, { active: 'dash', passive: 'afterglow' });
    b.soul.damage({ amount: 1, type: 'normal' });
    expect(b.soul.iframes).toBe(AFTERGLOW_IFRAMES);
    expect(AFTERGLOW_IFRAMES).toBeGreaterThan(IFRAME_DURATION);

    const c = new World(640, 369);
    equipLoadout(c, { active: 'blink', passive: 'quickCharge' });
    expect(c.ability!.cooldown).toBeCloseTo(BLINK_COOLDOWN * QUICK_CHARGE_COOLDOWN, 9);
    c.step(press(RIGHT), STEP);
    expect(c.ability!.remaining).toBeCloseTo(BLINK_COOLDOWN * QUICK_CHARGE_COOLDOWN - STEP, 9);

    const d = new World(640, 369);
    equipLoadout(d, { active: null, passive: 'steady' });
    expect(d.ability).toBeNull();
    for (let i = 0; i < 60; i++) d.step({ dx: 1, dy: 0, slow: true }, STEP);
    expect(d.soul.pos.x).toBeCloseTo(SOUL_SPEED * STEADY_SLOW_MULTIPLIER, 6);
    expect(STEADY_SLOW_MULTIPLIER).toBeGreaterThan(SLOW_MULTIPLIER);
  });
  it('every picker entry maps to a registered ability (and none)', () => {
    for (const a of ACTIVE_INFO) if (a.id) expect(a.id in ACTIVES).toBe(true);
    for (const p of PASSIVE_INFO) if (p.id) expect(p.id in PASSIVES).toBe(true);
    expect(Object.keys(ACTIVES).sort()).toEqual(['blink', 'dash', 'shield', 'slow']);
    expect(Object.keys(PASSIVES).sort()).toEqual(['afterglow', 'quickCharge', 'steady', 'thickSkin']);
    expect(new Dash().cooldown).toBe(DASH_COOLDOWN);
  });
});

describe('loadout storage', () => {
  it('saves every combination and reads it back; unknown or missing ids fall back to defaults', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    for (const a of ACTIVE_INFO) {
      for (const p of PASSIVE_INFO) {
        expect(saveLoadout(store, { active: a.id, passive: p.id })).toBe(true);
        expect(loadLoadout(store)).toEqual({ active: a.id, passive: p.id });
      }
    }
    expect(parseLoadout(JSON.stringify({ v: 1, active: 'teleport9000', passive: 'steady' }))).toEqual({ active: 'dash', passive: 'steady' });
    expect(parseLoadout(JSON.stringify({ v: 1, active: 'blink', passive: 'ghost' }))).toEqual({ active: 'blink', passive: null });
    expect(parseLoadout(JSON.stringify({ v: 1 }))).toEqual({ active: 'dash', passive: null });
    expect(mem.has(LOADOUT_KEY)).toBe(true);
  });
});

describe('slow time keeps interpolation smooth', () => {
  it('a straight bullet draws evenly spaced at 144 Hz through the slow and back; the soul keeps full speed', async () => {
    const { interpBullet, lerpPoint } = await import('../render/interp');
    const { Bullet: B } = await import('../combat/Bullet');
    const w = new World(640, 369);
    w.ability = new SlowTime();
    const b = w.pool.spawn({ shape: 'circle', a: 2, x: -400, y: -100, vx: 120, damage: 1, noPop: true })!;
    const out = new B();
    // Display frames at 144 Hz over 60 Hz steps: draw at the leftover alpha each frame.
    let acc = 0, lastX = NaN, lastSoul = NaN;
    const gaps: number[] = [], soulGaps: number[] = [];
    let stepped = 0;
    for (let f = 0; f < 144 * 3; f++) {
      acc += 1 / 144;
      while (acc >= STEP) {
        acc -= STEP;
        w.step(stepped === 30 ? press({ dx: 1, dy: 0, slow: false }) : { dx: stepped % 80 < 40 ? 1 : -1, dy: 0, slow: false }, STEP);
        stepped++;
      }
      const x = interpBullet(b, acc / STEP, out).x;
      const s = lerpPoint(w.soul.prev.x, w.soul.prev.y, w.soul.pos.x, w.soul.pos.y, acc / STEP, { x: 0, y: 0 }).x;
      if (stepped < 2) {
        lastX = NaN;
        continue; // nothing has moved before the first steps
      }
      if (!Number.isNaN(lastX)) {
        gaps.push(x - lastX);
        soulGaps.push(Math.abs(s - lastSoul));
      }
      lastX = x;
      lastSoul = s;
    }
    const scaled = gaps.filter((g) => g < (120 / 144) * 0.75);
    // Inside the slow: every frame moves 120 * 0.45 / 144 px; outside it 120 / 144 (to float precision).
    for (const g of gaps) {
      const ok = Math.abs(g - (120 * SLOWTIME_SCALE) / 144) < 1e-6 || Math.abs(g - 120 / 144) < 1e-6;
      // The frame that straddles the change blends the two rates.
      if (!ok) expect(g).toBeGreaterThan((120 * SLOWTIME_SCALE) / 144 - 1e-6);
      expect(g).toBeLessThan(120 / 144 + 1e-6);
    }
    expect(scaled.length).toBeGreaterThan(144 * SLOWTIME_DURATION * 0.9);
    // The soul's drawn speed never drops in the slow (it isn't scaled), except at the wall turns.
    expect(soulGaps.filter((g) => Math.abs(g - SOUL_SPEED / 144) < 1e-6).length).toBeGreaterThan(soulGaps.length * 0.9);
  });
});
