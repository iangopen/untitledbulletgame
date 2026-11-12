import type { Circle, Rect, Triangle } from './Collision';
import { bulletCircle, bulletRect, bulletTriangle, type Bullet } from './Bullet';

/**
 * Composite shapes (pure): a themed projectile (sword, axe, gust) is several primitive parts in the
 * bullet's own frame (+x = where it points, origin = the bullet's position/pivot, px at full size).
 * Drawing AND collision both go through `bulletPrimitives`, so every solid drawn part is exactly its
 * hitbox. Parts transform with the bullet's position, rotation and scale (spawn pop / grow-in).
 */
export type Part =
  | { kind: 'rect'; x: number; y: number; hw: number; hh: number; rot?: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'tri'; ax: number; ay: number; bx: number; by: number; cx: number; cy: number };

export interface CompositeForm {
  readonly parts: readonly Part[];
  /** Farthest point of any part from the origin (for off-screen spawns and culling). */
  readonly extent: number;
}

/** Build a form; its extent is computed from the parts. */
export function makeForm(parts: readonly Part[]): CompositeForm {
  let e = 0;
  for (const p of parts) {
    if (p.kind === 'circle') e = Math.max(e, Math.hypot(p.x, p.y) + p.r);
    else if (p.kind === 'rect') e = Math.max(e, Math.hypot(p.x, p.y) + Math.hypot(p.hw, p.hh));
    else e = Math.max(e, Math.hypot(p.ax, p.ay), Math.hypot(p.bx, p.by), Math.hypot(p.cx, p.cy));
  }
  return { parts, extent: e };
}

export type Primitive = { kind: 'circle'; c: Circle } | { kind: 'rect'; r: Rect } | { kind: 'tri'; t: Triangle };

// Scratch primitives: callers must use each one inside the callback (no allocation per call).
const sc: Circle = { x: 0, y: 0, r: 0 };
const sr: Rect = { x: 0, y: 0, hw: 0, hh: 0, rotation: 0 };
const st: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };
const pc: Primitive = { kind: 'circle', c: sc };
const pr: Primitive = { kind: 'rect', r: sr };
const pt: Primitive = { kind: 'tri', t: st };

/**
 * Every primitive of a bullet's exact shape, box-local: one for plain shapes, one per part for a
 * composite. The callback returns true to stop early (a hit). Returns whether it stopped.
 */
export function bulletPrimitives(b: Bullet, fn: (p: Primitive) => boolean | void): boolean {
  switch (b.shape) {
    case 'circle':
      bulletCircle(b, sc);
      return fn(pc) === true;
    case 'rect':
    case 'beam':
      bulletRect(b, sr);
      return fn(pr) === true;
    case 'triangle':
      bulletTriangle(b, st);
      return fn(pt) === true;
    case 'composite': {
      const form = b.form;
      if (!form) return false;
      const s = b.scale;
      const cos = Math.cos(b.rotation);
      const sin = Math.sin(b.rotation);
      const tx = (x: number, y: number) => b.x + (x * cos - y * sin) * s;
      const ty = (x: number, y: number) => b.y + (x * sin + y * cos) * s;
      for (const p of form.parts) {
        let stop: boolean | void;
        if (p.kind === 'circle') {
          sc.x = tx(p.x, p.y);
          sc.y = ty(p.x, p.y);
          sc.r = p.r * s;
          stop = fn(pc);
        } else if (p.kind === 'rect') {
          sr.x = tx(p.x, p.y);
          sr.y = ty(p.x, p.y);
          sr.hw = p.hw * s;
          sr.hh = p.hh * s;
          sr.rotation = b.rotation + (p.rot ?? 0);
          stop = fn(pr);
        } else {
          st.ax = tx(p.ax, p.ay); st.ay = ty(p.ax, p.ay);
          st.bx = tx(p.bx, p.by); st.by = ty(p.bx, p.by);
          st.cx = tx(p.cx, p.cy); st.cy = ty(p.cx, p.cy);
          stop = fn(pt);
        }
        if (stop === true) return true;
      }
      return false;
    }
  }
}

/** A curved streak as a chain of thin rects along y = bend * sin(pi * t) (t 0..1 along x), centered on the origin. */
export function curvedStreak(length: number, thickness: number, bend: number, segments: number): Part[] {
  const parts: Part[] = [];
  const pt = (t: number) => ({ x: (t - 0.5) * length, y: bend * Math.sin(Math.PI * t) - bend / 2 });
  for (let i = 0; i < segments; i++) {
    const a = pt(i / segments);
    const c = pt((i + 1) / segments);
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    // Segments overlap by one thickness so the drawn streak has no notches at the joints.
    parts.push({ kind: 'rect', x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, hw: len / 2 + thickness / 2, hh: thickness / 2, rot: Math.atan2(c.y - a.y, c.x - a.x) });
  }
  return parts;
}
