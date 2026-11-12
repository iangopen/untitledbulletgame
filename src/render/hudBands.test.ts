import { describe, expect, it } from 'vitest';
import { World } from '../core/World';
import { STEP } from '../core/Clock';
import { Director } from '../director/Director';
import { TimerMode } from '../director/modes/TimerMode';
import { Bullet, rectCorners } from '../combat/Bullet';
import { bulletPrimitives } from '../combat/composite';
import { interpBullet } from './interp';
import { hud, theme, VIEW } from './theme';

/** World-space AABB of a bullet's full-size exact shape (every primitive), clipped test to the screen; null if fully off screen. */
function screenAabb(w: World, b: Bullet): { x0: number; y0: number; x1: number; y1: number } | null {
  const full = interpBullet(b, 1, new Bullet());
  full.armed = true; // full size even while growing in
  full.noPop = true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    const p = w.box.toWorld({ x, y });
    x0 = Math.min(x0, p.x - r); x1 = Math.max(x1, p.x + r); y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r);
  };
  bulletPrimitives(full, (p) => {
    if (p.kind === 'circle') add(p.c.x, p.c.y, p.c.r);
    else if (p.kind === 'tri') { add(p.t.ax, p.t.ay); add(p.t.bx, p.t.by); add(p.t.cx, p.t.cy); }
    else for (const q of rectCorners(p.r, [0, 1, 2, 3].map(() => ({ x: 0, y: 0 })))) add(q.x, q.y);
  });
  if (x1 < 0 || x0 > VIEW.width || y1 < 0 || y0 > VIEW.height) return null;
  return { x0, y0, x1, y1 };
}

const inBand = (a: { y0: number; y1: number }) =>
  [hud.top, hud.bottom].some((b) => a.y1 >= b.y && a.y0 <= b.y + b.height);

describe('HUD bands', () => {
  it('are inside the layout and clear of the box', () => {
    expect(hud.top.y).toBe(0);
    expect(hud.bottom.y + hud.bottom.height).toBe(VIEW.height);
    const w = new World(VIEW.cx, VIEW.cy + 9);
    expect(w.box.y - w.box.halfHeight).toBeGreaterThan(hud.top.y + hud.top.height);
    expect(w.box.y + w.box.halfHeight).toBeLessThan(hud.bottom.y);
  });

  it('all eight characters at 20 for 40 s (box shoved, tossed and split): no spawn or gold-forming stage lands in a HUD band', () => {
    const w = new World(VIEW.cx, VIEW.cy + 9);
    const d = new Director(w, { rose: 20, prism: 20, mortimer: 20, ulysses: 20, warden: 20, ember: 20, volt: 20, vesper: 20 }, new TimerMode(60));
    const seen = new Set<Bullet>();
    let splitSteps = 0, boxInBand = 0, scaledSteps = 0, scaledSpawns = 0, minScale = 1;
    let blooms = 0, bloomInBand = 0, prismDecor = 0, prismDecorBad = 0;
    let spawns = 0, onScreenSpawns = 0, spawnInBand = 0, goldSteps = 0, goldInBand = 0, passingInBand = 0;
    // The Director's step, split so spawns are measured where they spawn (before the world moves them).
    const tick = () => d.characters.forEach((c) => c.tick(STEP));
    for (let i = 0; i < 60 * 40; i++) {
      tick();
      measure();
      w.step({ dx: 0, dy: 0, slow: false }, STEP);
      w.soul.iframes = 1;
      // Every box (two while The Warden has it ripped apart) stays between the bands.
      if (w.boxes.length > 1) splitSteps++;
      if (w.box.scale < 0.999) scaledSteps++;
      minScale = Math.min(minScale, w.box.scale);
      for (const bx of w.boxes) {
        const hx = bx.halfWidth * Math.abs(Math.cos(bx.rotation)) + bx.halfHeight * Math.abs(Math.sin(bx.rotation));
        const hy = bx.halfWidth * Math.abs(Math.sin(bx.rotation)) + bx.halfHeight * Math.abs(Math.cos(bx.rotation));
        if (bx.y - hy < hud.top.y + hud.top.height || bx.y + hy > hud.bottom.y || bx.x - hx < 0 || bx.x + hx > VIEW.width) boxInBand++;
      }
    }
    function measure(): void {
      for (const b of w.pool.all) {
        // The Warden's fists are objects, not attacks (they never collide); his test keeps them clear too.
        // Rose's blooms (decor, a forming stage before the ring) must stay out of the bands like gold.
        if (b.active && b.decor && b.owner === 'rose') {
          blooms++;
          const a = screenAabb(w, b);
          if (a && inBand(a)) bloomInBand++;
        }
        // Prism's mirrors and blaster emitters (decor) stand outside the box, on screen, out of the bands.
        if (b.active && b.decor && b.owner === 'prism') {
          prismDecor++;
          const a = screenAabb(w, b);
          if (!a || inBand(a)) prismDecorBad++;
        }
        if (!b.active || b.decor) continue;
        const a = screenAabb(w, b);
        if (!seen.has(b)) {
          seen.add(b);
          spawns++;
          if (w.box.scale < 0.999) scaledSpawns++;
          if (a) onScreenSpawns++;
          if (a && inBand(a)) spawnInBand++;
        }
        if (!b.armed) {
          goldSteps++;
          if (a && inBand(a)) goldInBand++;
        } else if (a && inBand(a)) passingInBand++;
      }
      for (const b of [...seen]) if (!b.active) seen.delete(b);
    }
    // eslint-disable-next-line no-console
    console.log(`HUD bands, all eight at 20 for 40 s: tossed ${(scaledSteps / 60).toFixed(1)} s (min scale ${minScale.toFixed(2)}, ${scaledSpawns} spawns while tossed); ${spawns} spawns (${onScreenSpawns} on screen), ${spawnInBand} in a band; ${goldSteps} gold bullet-steps, ${goldInBand} in a band; ${passingInBand} active bullet-steps passing through a band; split ${(splitSteps / 60).toFixed(1)} s, box steps in a band or off screen ${boxInBand}`);
    // eslint-disable-next-line no-console
    console.log(`Rose bloom steps ${blooms}, in a band ${bloomInBand}; Prism mirror/emitter steps ${prismDecor}, off screen or in a band ${prismDecorBad}`);
    expect(spawnInBand).toBe(0);
    expect(goldInBand).toBe(0);
    expect(blooms).toBeGreaterThan(0);
    expect(bloomInBand).toBe(0);
    expect(prismDecor).toBeGreaterThan(0);
    expect(prismDecorBad).toBe(0);
    expect(splitSteps).toBeGreaterThan(60 * 3); // the rip at 18 s is covered
    expect(boxInBand).toBe(0);
    expect(scaledSteps).toBeGreaterThan(60 * 2); // the toss at 9 s is covered
    expect(scaledSpawns).toBeGreaterThan(10);
  });

  it('HP bar color is distinct from every projectile and forming color', () => {
    const others = [...Object.values(theme.bullet), theme.preActive, theme.ulysses, theme.wallDamaging, theme.soul];
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    for (const c of others) {
      const [r1, g1, b1] = rgb(theme.hpFill);
      const [r2, g2, b2] = rgb(c);
      expect(Math.hypot(r1! - r2!, g1! - g2!, b1! - b2!), `#${c.toString(16)}`).toBeGreaterThan(100);
    }
  });
});
