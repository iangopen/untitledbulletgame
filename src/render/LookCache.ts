import Phaser from 'phaser';
import { Bullet, rectCorners } from '../combat/Bullet';
import { bulletPrimitives, type CompositeForm, type Primitive } from '../combat/composite';
import type { Rect } from '../combat/Collision';

/**
 * A cached look: a WHITE texture of one shape at the current render resolution, plus where the
 * shape's origin sits in it. Sprites draw it tinted (color), positioned, rotated and scaled, so a
 * look is rasterised once instead of rebuilding paths every frame.
 *  - `k`: texture px per layout px (= renderScale when it was built). A sprite at scale `s / k` draws
 *    the shape at `s` x its built size, 1 texel = 1 device px at s = 1.
 *  - `size`: the size the look was built at (circle radius for size buckets; 1 otherwise).
 */
export interface Look {
  key: string;
  /** Origin as a fraction of the texture (Phaser setOrigin). */
  ox: number;
  oy: number;
  k: number;
  size: number;
}

/** Glow layers around rect parts of light rays: [extra half-size px, alpha factor]. Decorative only. */
export const GLOW_LAYERS: readonly [number, number][] = [[7, 0.5], [3.5, 1]];
/** Circle size buckets grow by this factor, so a sprite only ever scales a circle down by < 13%. */
const CIRCLE_BUCKET = 1.15;
/** Transparent texels around every shape so its anti-aliased edge is never clipped. */
const PAD = 2;
/** Stroke width of decor edges (layout px). */
const EDGE_WIDTH = 2;

let formIds = new WeakMap<CompositeForm, number>();
let nextFormId = 1;
function formId(f: CompositeForm): number {
  let id = formIds.get(f);
  if (id === undefined) {
    id = nextFormId++;
    formIds.set(f, id);
  }
  return id;
}

/**
 * Builds and caches looks for one scene. Every look is drawn from the same primitives collision
 * uses (`bulletPrimitives` on a template bullet at the origin), so the solid sprite IS the hitbox
 * shape; only its anti-aliased edge (under a device pixel) is rasterised. Call `sync(scale)` once
 * per frame: when the render scale changes (quality setting, devicePixelRatio, window size) every
 * texture is dropped and rebuilt at the new resolution on demand, so edges stay crisp.
 */
export class LookCache {
  private k = 0;
  private readonly looks = new Map<string, Look>();
  private readonly tpl = new Bullet();
  private readonly gr: Rect = { x: 0, y: 0, hw: 0, hh: 0, rotation: 0 };
  private readonly pts = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));
  /** Textures built since creation (diagnostics). */
  built = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  get scale(): number {
    return this.k;
  }

  get size(): number {
    return this.looks.size;
  }

  /** Rebuild everything when the render scale changed. Returns true if it did. */
  sync(scale: number): boolean {
    if (scale === this.k) return false;
    this.clear();
    this.k = scale;
    return true;
  }

  clear(): void {
    for (const l of this.looks.values()) if (this.scene.textures.exists(l.key)) this.scene.textures.remove(l.key);
    this.looks.clear();
  }

  /** The solid look of a bullet (shape and size, never color or alpha: those are tint and sprite alpha). */
  bullet(b: Bullet): Look {
    // A ring is drawn as stretched chord segments of a line look `b` thick (see BattleView).
    if (b.shape === 'ring') return this.line(b.b);
    if (b.shape === 'circle') {
      // Size buckets: radius rounded up to the next bucket; the sprite scales it down to the exact radius.
      const r = Math.max(0.5, b.a);
      const bucket = Math.pow(CIRCLE_BUCKET, Math.ceil(Math.log(r) / Math.log(CIRCLE_BUCKET)));
      return this.get(`c:${bucket.toFixed(4)}`, bucket, (t) => {
        t.shape = 'circle';
        t.a = bucket;
      });
    }
    const key =
      b.shape === 'composite' ? `f:${b.form ? formId(b.form) : 0}` : `${b.shape}:${b.a.toFixed(3)}:${b.b.toFixed(3)}`;
    return this.get(key, 1, (t) => {
      t.shape = b.shape;
      t.a = b.a;
      t.b = b.b;
      t.form = b.form;
    });
  }

  /**
   * The edge of a decor object (a fist): every part outlined, so its rocky blocks read as solid
   * objects with visible edges. Drawing only; decor never collides.
   */
  edge(b: Bullet): Look {
    const key = b.shape === 'composite' ? `e:f:${b.form ? formId(b.form) : 0}` : `e:${b.shape}:${b.a.toFixed(3)}:${b.b.toFixed(3)}`;
    return this.get(key, 1, (t) => {
      t.shape = b.shape;
      t.a = b.a;
      t.b = b.b;
      t.form = b.form;
    }, false, EDGE_WIDTH);
  }

  /** The decorative glow of a bullet (layers around each rect part), or the same key family. */
  glow(b: Bullet): Look {
    const key = b.shape === 'composite' ? `g:f:${b.form ? formId(b.form) : 0}` : `g:${b.shape}:${b.a.toFixed(3)}:${b.b.toFixed(3)}`;
    return this.get(key, 1, (t) => {
      t.shape = b.shape;
      t.a = b.a;
      t.b = b.b;
      t.form = b.form;
    }, true);
  }

  /** A filled disc of radius r (soul, dash trail, shine fill). */
  disc(r: number): Look {
    return this.get(`d:${r.toFixed(3)}`, r, (t) => {
      t.shape = 'circle';
      t.a = r;
    });
  }

  /** A ring of radius r and stroke width w (shine), rasterised at its exact size. */
  ring(r: number, w: number): Look {
    const key = `r:${r.toFixed(2)}:${w}`;
    const hit = this.looks.get(key);
    if (hit) return hit;
    const k = this.k;
    const ext = r + w / 2;
    const size = Math.ceil(2 * ext * k) + 2 * PAD;
    const tex = this.scene.textures.createCanvas(key, size, size)!;
    const ctx = tex.getContext();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = w * k;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r * k, 0, Math.PI * 2);
    ctx.stroke();
    tex.refresh();
    return this.store(key, { key, ox: 0.5, oy: 0.5, k, size: r });
  }

  /** A translucent triangle prop (fill alpha `fill`, outline `stroke` px at alpha `strokeAlpha`), first vertex at angle 0. */
  prop(r: number, fill: number, stroke: number, strokeAlpha: number): Look {
    const key = `p:${r}:${fill}:${stroke}:${strokeAlpha}`;
    const hit = this.looks.get(key);
    if (hit) return hit;
    const k = this.k;
    const size = Math.ceil(2 * (r + stroke) * k) + 2 * PAD;
    const tex = this.scene.textures.createCanvas(key, size, size)!;
    const ctx = tex.getContext();
    const c = size / 2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](c + Math.cos(a) * r * k, c + Math.sin(a) * r * k);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${fill})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${strokeAlpha})`;
    ctx.lineWidth = stroke * k;
    ctx.stroke();
    tex.refresh();
    return this.store(key, { key, ox: 0.5, oy: 0.5, k, size: 1 });
  }

  /**
   * A wall line of thickness `w`: a short texture with exact, anti-aliased long edges, stretched
   * along its length by the sprite (its ends meet the neighbouring walls at the corners).
   */
  line(w: number): Look {
    const key = `l:${w}`;
    const hit = this.looks.get(key);
    if (hit) return hit;
    const k = this.k;
    const h = Math.ceil(w * k) + 2 * PAD;
    const tex = this.scene.textures.createCanvas(key, 4, h)!;
    const ctx = tex.getContext();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, h / 2 - (w * k) / 2, 4, w * k);
    tex.refresh();
    // size = texture width (texels): a sprite scaled by len / size along x spans len layout px.
    return this.store(key, { key, ox: 0.5, oy: 0.5, k, size: 4 });
  }

  private store(key: string, look: Look): Look {
    this.looks.set(key, look);
    this.built++;
    return look;
  }

  /**
   * Build (once) the look of the template bullet set up by `setup`: every primitive of its exact
   * shape at rotation 0, origin at the bullet position, filled white (or its glow layers).
   */
  private get(key: string, size: number, setup: (t: Bullet) => void, glow = false, stroke = 0): Look {
    const hit = this.looks.get(key);
    if (hit) return hit;
    const t = this.tpl;
    t.x = 0;
    t.y = 0;
    t.rotation = 0;
    t.noPop = true;
    t.armed = true;
    t.growIn = false;
    t.form = null;
    setup(t);
    const prims: Primitive[] = [];
    // Copy each primitive (bulletPrimitives reuses scratch objects).
    bulletPrimitives(t, (p) => {
      if (p.kind === 'circle') prims.push({ kind: 'circle', c: { ...p.c } });
      else if (p.kind === 'rect') prims.push({ kind: 'rect', r: { ...p.r } });
      else prims.push({ kind: 'tri', t: { ...p.t } });
    });
    const pad = glow ? Math.max(...GLOW_LAYERS.map(([p]) => p)) : stroke;
    // Tight bounds in layout px.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x: number, y: number, r: number) => {
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
    };
    for (const p of prims) {
      if (p.kind === 'circle') add(p.c.x, p.c.y, p.c.r + stroke);
      else if (p.kind === 'tri') { add(p.t.ax, p.t.ay, stroke); add(p.t.bx, p.t.by, stroke); add(p.t.cx, p.t.cy, stroke); }
      else for (const q of rectCorners(p.r, this.pts)) add(q.x, q.y, pad * Math.SQRT2);
    }
    const k = this.k;
    const w = Math.ceil((x1 - x0) * k) + 2 * PAD;
    const h = Math.ceil((y1 - y0) * k) + 2 * PAD;
    const tex = this.scene.textures.createCanvas(key, Math.max(1, w), Math.max(1, h))!;
    const ctx = tex.getContext();
    // Layout px -> texture px; the origin (0, 0) lands at (ox, oy).
    const ox = PAD - x0 * k;
    const oy = PAD - y0 * k;
    ctx.setTransform(k, 0, 0, k, ox, oy);
    if (glow) {
      for (const [p, f] of GLOW_LAYERS) {
        ctx.fillStyle = `rgba(255,255,255,${f})`;
        for (const q of prims) {
          if (q.kind !== 'rect') continue;
          const r = this.gr;
          r.x = q.r.x; r.y = q.r.y; r.rotation = q.r.rotation;
          r.hw = q.r.hw + p;
          r.hh = q.r.hh + p;
          this.poly(ctx, rectCorners(r, this.pts));
          ctx.fill();
        }
      }
    } else if (stroke > 0) {
      // Outline of every part (decor edges): drawn inside and out of each part's boundary.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = stroke;
      ctx.lineJoin = 'round';
      for (const p of prims) {
        ctx.beginPath();
        if (p.kind === 'circle') ctx.arc(p.c.x, p.c.y, p.c.r, 0, Math.PI * 2);
        else if (p.kind === 'tri') this.sub(ctx, [{ x: p.t.ax, y: p.t.ay }, { x: p.t.bx, y: p.t.by }, { x: p.t.cx, y: p.t.cy }]);
        else this.sub(ctx, rectCorners(p.r, this.pts));
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#fff';
      // One path for all parts (nonzero fill): overlaps never double up, the union is solid.
      ctx.beginPath();
      for (const p of prims) {
        if (p.kind === 'circle') {
          ctx.moveTo(p.c.x + p.c.r, p.c.y);
          ctx.arc(p.c.x, p.c.y, p.c.r, 0, Math.PI * 2);
        } else if (p.kind === 'tri') {
          this.sub(ctx, [{ x: p.t.ax, y: p.t.ay }, { x: p.t.bx, y: p.t.by }, { x: p.t.cx, y: p.t.cy }]);
        } else {
          this.sub(ctx, rectCorners(p.r, this.pts));
        }
      }
      ctx.fill('nonzero');
    }
    tex.refresh();
    return this.store(key, { key, ox: ox / w, oy: oy / h, k, size });
  }

  private poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    ctx.beginPath();
    this.sub(ctx, pts);
  }

  /** Add a closed polygon to the current path, always wound the same way (so nonzero fill unions). */
  private sub(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    const order = area >= 0 ? pts : [...pts].reverse();
    ctx.moveTo(order[0]!.x, order[0]!.y);
    for (let i = 1; i < order.length; i++) ctx.lineTo(order[i]!.x, order[i]!.y);
    ctx.closePath();
  }
}

/** Test seam: forget composite ids (new forms get fresh keys). */
export function resetFormIds(): void {
  formIds = new WeakMap();
  nextFormId = 1;
}
