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

  it('all four characters at 20 for 40 s (box shoved and spun): no spawn or gold-forming stage lands in a HUD band', () => {
    const w = new World(VIEW.cx, VIEW.cy + 9);
    const d = new Director(w, { prism: 20, mortimer: 20, ulysses: 20, warden: 20 }, new TimerMode(60));
    const seen = new Set<Bullet>();
    let spawns = 0, onScreenSpawns = 0, spawnInBand = 0, goldSteps = 0, goldInBand = 0, passingInBand = 0;
    // The Director's step, split so spawns are measured where they spawn (before the world moves them).
    const tick = () => d.characters.forEach((c) => c.tick(STEP));
    for (let i = 0; i < 60 * 40; i++) {
      tick();
      measure();
      w.step({ dx: 0, dy: 0, slow: false }, STEP);
      w.soul.iframes = 1;
    }
    function measure(): void {
      for (const b of w.pool.all) {
        // The Warden's fists are objects, not attacks (they never collide); his test keeps them clear too.
        if (!b.active || b.decor) continue;
        const a = screenAabb(w, b);
        if (!seen.has(b)) {
          seen.add(b);
          spawns++;
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
    console.log(`HUD bands, all four at 20 for 40 s: ${spawns} spawns (${onScreenSpawns} on screen), ${spawnInBand} in a band; ${goldSteps} gold bullet-steps, ${goldInBand} in a band; ${passingInBand} active bullet-steps passing through a band`);
    expect(spawnInBand).toBe(0);
    expect(goldInBand).toBe(0);
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
