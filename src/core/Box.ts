export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The arena. Its center is the origin of box-local space; x right, y down.
 * Phase 1 is static, but the transform already supports rotation so Phase 5
 * (dynamic box) builds on this API without changing callers.
 */
export class Box {
  constructor(
    /** World-space center. */
    public x: number,
    public y: number,
    /** Interior width/height in px. */
    public width: number,
    public height: number,
    /** Rotation in radians. */
    public rotation = 0,
  ) {}

  get halfWidth(): number {
    return this.width / 2;
  }
  get halfHeight(): number {
    return this.height / 2;
  }

  toWorld(local: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const lx = local.x;
    const ly = local.y;
    out.x = this.x + lx * c - ly * s;
    out.y = this.y + lx * s + ly * c;
    return out;
  }

  toLocal(world: Vec2, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const dx = world.x - this.x;
    const dy = world.y - this.y;
    out.x = dx * c + dy * s;
    out.y = -dx * s + dy * c;
    return out;
  }

  /** Clamp a box-local point so a circle of `radius` stays inside the interior. */
  clampLocal(p: Vec2, radius = 0): Vec2 {
    const hw = Math.max(0, this.halfWidth - radius);
    const hh = Math.max(0, this.halfHeight - radius);
    p.x = Math.min(hw, Math.max(-hw, p.x));
    p.y = Math.min(hh, Math.max(-hh, p.y));
    return p;
  }
}
