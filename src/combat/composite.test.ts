import { describe, expect, it } from 'vitest';
import { BulletPool } from './BulletPool';
import { bulletHitsCircle } from './hitTest';
import { bulletPrimitives, curvedStreak, makeForm, type Primitive } from './composite';
import { Bullet, bulletExtent } from './Bullet';
import { interpBullet } from '../render/interp';

// A "T": a long bar along +x and a short crossbar at x = 10, plus a round knob at the origin.
const T = makeForm([
  { kind: 'rect', x: 30, y: 0, hw: 20, hh: 2 },
  { kind: 'rect', x: 10, y: 0, hw: 2, hh: 8 },
  { kind: 'circle', x: 0, y: 0, r: 3 },
]);

function spawn(rotation: number, scale = 1) {
  const p = new BulletPool(2);
  const b = p.spawn({ shape: 'composite', form: T, x: 100, y: 50, rotation, a: 0, damage: 1, noPop: scale === 1 })!;
  return b;
}
const at = (b: { x: number; y: number; rotation: number }, lx: number, ly: number) => ({
  x: b.x + lx * Math.cos(b.rotation) - ly * Math.sin(b.rotation),
  y: b.y + lx * Math.sin(b.rotation) + ly * Math.cos(b.rotation),
});

describe('composite shapes', () => {
  it('extent covers every part', () => {
    // The farthest corner of the bar is (50, 2); the extent may round up but must cover it.
    expect(T.extent).toBeGreaterThanOrEqual(Math.hypot(50, 2));
    expect(T.extent).toBeLessThan(51);
    expect(bulletExtent({ shape: 'composite', a: 0, form: T })).toBe(T.extent);
  });

  for (const rot of [0, Math.PI / 2, 0.7, -2.3]) {
    it(`hits each part and misses the gaps between them (rotation ${rot.toFixed(2)})`, () => {
      const b = spawn(rot);
      const probe = (lx: number, ly: number) => bulletHitsCircle(b, { ...at(b, lx, ly), r: 0.25 });
      // Bar: tip and edges.
      expect(probe(49.7, 0)).toBe(true);
      expect(probe(50.3, 0)).toBe(false);
      expect(probe(30, 1.7)).toBe(true);
      expect(probe(30, 2.3)).toBe(false);
      // Crossbar sticks out sideways; the bar doesn't there.
      expect(probe(10, 7.7)).toBe(true);
      expect(probe(10, 8.3)).toBe(false);
      expect(probe(30, 7.7)).toBe(false);
      // Knob.
      expect(probe(-2.7, 0)).toBe(true);
      expect(probe(-3.3, 0)).toBe(false);
      // Behind the knob, beside the crossbar: empty.
      expect(probe(-1, 6)).toBe(false);
    });
  }

  it('drawing and collision see the same primitives (one definition)', () => {
    const b = spawn(0.4);
    const seen: string[] = [];
    bulletPrimitives(b, (p: Primitive) => void seen.push(p.kind));
    expect(seen).toEqual(['rect', 'rect', 'circle']);
  });

  it('a forming (growIn) composite is full size from the start and only fades in', () => {
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'composite', form: T, x: 0, y: 0, a: 0, damage: 1, armDelay: 1, growIn: true })!;
    b.age = 0.2; // half way through its fade (GOLD_FADE_TIME 0.4)
    expect(b.scale).toBe(1);
    expect(b.fadeAlpha).toBeCloseTo(0.5);
    const tips: number[] = [];
    bulletPrimitives(b, (q) => void (q.kind === 'rect' && tips.push(q.r.x + q.r.hw)));
    expect(tips[0]).toBeCloseTo(50);
  });

  it('curved streak: a chain of rects following the curve, joints covered', () => {
    const parts = curvedStreak(60, 4, 10, 6);
    expect(parts).toHaveLength(6);
    const f = makeForm(parts);
    const p = new BulletPool(2);
    const b = p.spawn({ shape: 'composite', form: f, x: 0, y: 0, a: 0, damage: 1, noPop: true })!;
    // On the curve everywhere along it (y = 10 sin(pi t) - 5), off it 4 px away.
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const x = (t - 0.5) * 60;
      const y = 10 * Math.sin(Math.PI * t) - 5;
      expect(bulletHitsCircle(b, { x, y, r: 0.5 })).toBe(true);
      if (i > 1 && i < 19) expect(bulletHitsCircle(b, { x, y: y + 4.5, r: 0.5 })).toBe(false);
    }
  });
});

describe('themed shapes changed this session: drawn == hitbox', () => {
  it('Rose thorn and vine: drawn primitives == collision primitives at 3 rotations; tip, stem and thorn probes', async () => {
    const { thornForm, vineForm, roseConfig } = await import('../characters/rose/rose.config');
    const r = roseConfig.rules;
    const thorn = thornForm(r.volleySize);
    const vine = vineForm(r.vineLength, r.vineThickness, r.vineThorn, r.vineThornPitch);
    for (const rot of [0, 0.4, 2.2]) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const local = (lx: number, ly: number, rad = 0.2) => ({ x: c * lx - s * ly, y: s * lx + c * ly, r: rad });
      for (const f of [thorn, vine]) {
        const b = new BulletPool(1).spawn({ shape: 'composite', form: f, x: 0, y: 0, a: 0, damage: 1, rotation: rot })!;
        const drawn: string[] = [];
        const hit: string[] = [];
        bulletPrimitives(b, (p) => void hit.push(JSON.stringify(p)));
        bulletPrimitives(interpBullet(b, 1, new Bullet()), (p) => void drawn.push(JSON.stringify(p)));
        expect(drawn).toEqual(hit);
        expect(hit.length).toBe(f.parts.length);
        if (f === thorn) {
          expect(bulletHitsCircle(b, local(r.volleySize - 0.4, 0))).toBe(true); // just inside the tip
          expect(bulletHitsCircle(b, local(r.volleySize + 0.4, 0))).toBe(false); // just past it
          expect(bulletHitsCircle(b, local(0, r.volleySize * 0.7))).toBe(false); // beside the spike, no hook there
        } else {
          const h = r.vineThickness / 2;
          expect(bulletHitsCircle(b, local(-300, h - 0.3))).toBe(true); // stem, inside its edge
          expect(bulletHitsCircle(b, local(r.vineThickness * 1.8 - 0.4, 0))).toBe(true); // vine tip
          expect(bulletHitsCircle(b, local(r.vineThickness * 1.8 + 0.4, 0))).toBe(false);
          expect(bulletHitsCircle(b, local(-300, h + r.vineThorn + 0.5))).toBe(false); // beyond the longest thorn
        }
      }
    }
  });
  it('snowflake: six arms with branches; probes hit on the arms and miss between them', async () => {
    const { snowflakeForm } = await import('../characters/mortimer/mortimer.config');
    const R = 9;
    const f = snowflakeForm(R);
    expect(f.parts.length).toBe(1 + 6 * 3);
    expect(f.extent).toBeGreaterThanOrEqual(R);
    for (const rot of [0, 0.3, 1.1]) {
      const b = new BulletPool(1).spawn({ shape: 'composite', form: f, x: 0, y: 0, a: 0, damage: 1, rotation: rot })!;
      for (let i = 0; i < 6; i++) {
        const a = rot + (i * Math.PI) / 3;
        // Near the tip of every arm: hit. Half way between two arms at 80% radius: miss.
        expect(bulletHitsCircle(b, { x: Math.cos(a) * R * 0.95, y: Math.sin(a) * R * 0.95, r: 0.2 })).toBe(true);
        const m = a + Math.PI / 6;
        expect(bulletHitsCircle(b, { x: Math.cos(m) * R * 0.9, y: Math.sin(m) * R * 0.9, r: 0.2 })).toBe(false);
      }
      const drawn: string[] = [];
      const hit: string[] = [];
      bulletPrimitives(b, (p) => void hit.push(JSON.stringify(p)));
      bulletPrimitives(interpBullet(b, 1, new Bullet()), (p) => void drawn.push(JSON.stringify(p)));
      expect(drawn).toEqual(hit);
    }
  });
  it('axe head is much wider in proportion (about 48 px along the handle, was 18) and exact', async () => {
    const { axeForm } = await import('../characters/ulysses/ulysses.config');
    const f = axeForm(210, 1);
    let x0 = Infinity, x1 = -Infinity;
    for (const p of f.parts.slice(1)) {
      if (p.kind === 'rect') { x0 = Math.min(x0, p.x - p.hw); x1 = Math.max(x1, p.x + p.hw); }
      if (p.kind === 'tri') { x0 = Math.min(x0, p.ax, p.bx, p.cx); x1 = Math.max(x1, p.ax, p.bx, p.cx); }
    }
    expect(x1 - x0).toBeGreaterThanOrEqual(46);
    const b = new BulletPool(1).spawn({ shape: 'composite', form: f, x: 0, y: 0, a: 0, damage: 1 })!;
    // Inside the head block's far corner region, and just past the cutting edge.
    expect(bulletHitsCircle(b, { x: 210 - 40, y: 20, r: 0.2 })).toBe(true);
    expect(bulletHitsCircle(b, { x: 210 - 22, y: 31.6, r: 0.2 })).toBe(false);
  });
});
