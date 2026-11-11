/**
 * Feel-tuning constants. Every number Ian tunes by hand lives here.
 * Units: pixels, seconds, HP points.
 */

/** Soul movement speed in px/s. */
export const SOUL_SPEED = 170;
/** Speed multiplier while Shift is held. */
export const SLOW_MULTIPLIER = 0.45;
/** Soul radius in px. Drawn circle and collision circle are both exactly this. */
export const SOUL_RADIUS = 6;

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

/** Bullet pool capacity. Spawns past this fail with a dev warning. */
export const BULLET_CAPACITY = 1024;
/** Bullets despawn once their center is this far outside the box, in px. */
export const DESPAWN_MARGIN = 48;
/** Spawn scale-pop duration (s). Draw AND hitbox scale together during it. */
export const SPAWN_POP_TIME = 0.08;
/** Despawn fade duration (s). Visual-only ghost; no collision. */
export const DESPAWN_FADE_TIME = 0.12;
/** Hit feedback. */
export const HIT_SHAKE_MS = 90;
export const HIT_SHAKE_INTENSITY = 0.006;
export const HIT_FLASH_MS = 70;

/** Timer mode: seconds to survive to win. */
export const TIMER_DURATION = 120;
/** Scene transition fade (ms): short and punchy. */
export const SCENE_FADE_MS = 140;
