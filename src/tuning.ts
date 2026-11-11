/**
 * Feel-tuning constants. Every number Ian tunes by hand lives here.
 * Units: pixels, seconds, HP points.
 */

/** Soul movement speed in px/s. */
export const SOUL_SPEED = 170;
/** Speed multiplier while Shift is held. */
export const SLOW_MULTIPLIER = 0.45;
/** Collision radius of the soul in px. Deliberately much smaller than the drawn soul. */
export const HITBOX_RADIUS = 3;
/** Half-size of the drawn soul in px (visual only). */
export const SOUL_DRAW_SIZE = 8;

/** Maximum HP. */
export const MAX_HP = 100;
/** Invulnerability after a hit, in seconds. */
export const IFRAME_DURATION = 1.0;
/** Blink period of the soul during i-frames, in seconds. */
export const IFRAME_BLINK_PERIOD = 0.1;

/** KR pool drain rate in HP/s. The pool keeps draining during i-frames. */
export const KR_DRAIN_RATE = 8;

/** Box interior size in px (Phase 1: static). */
export const BOX_WIDTH = 300;
export const BOX_HEIGHT = 220;
/** Box border thickness in px. */
export const BOX_BORDER = 2;
