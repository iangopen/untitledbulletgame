/**
 * Feel-tuning constants. Every number Ian tunes by hand lives here.
 * Units: pixels (of the 1280x720 virtual view), seconds, HP points.
 */

/**
 * Scale from the original 640x480 view to the 1280x720 view (720 / 480).
 * Every gameplay distance, size and speed is written as `px(original)` so the soul,
 * box, bullets and hitboxes keep the same size and speed relative to the view.
 */
export const WORLD_SCALE = 1.5;
export const px = (original: number): number => original * WORLD_SCALE;

/** Soul movement speed in px/s (was 170). */
export const SOUL_SPEED = px(170);
/** Speed multiplier while Shift is held. */
export const SLOW_MULTIPLIER = 0.45;
/** Soul radius in px (was 6). Drawn circle and collision circle are both exactly this. */
export const SOUL_RADIUS = px(6);

/** Maximum HP. */
export const MAX_HP = 100;
/** Invulnerability after a hit, in seconds. */
export const IFRAME_DURATION = 1.0;
/** Blink period of the soul during i-frames, in seconds. */
export const IFRAME_BLINK_PERIOD = 0.1;

/** KR pool drain rate in HP/s. The pool keeps draining during i-frames. */
export const KR_DRAIN_RATE = 8;

/** Box interior size in px (was 300x220). */
export const BOX_WIDTH = px(300);
export const BOX_HEIGHT = px(220);
/** Minimum box interior (px, was 60x60). Every resize is clamped to this, so the soul always has room to move. */
export const BOX_MIN_WIDTH = px(60);
export const BOX_MIN_HEIGHT = px(60);
/** The soul touches a wall when within this many px of being pressed against it (was 0.5). */
export const WALL_CONTACT_EPS = px(0.5);
/** Default damage for a damaging wall. */
export const WALL_DAMAGE = 5;

/** Bullet pool capacity. Spawns past this fail with a dev warning. */
export const BULLET_CAPACITY = 1024;
/**
 * Bullets despawn once their center is this far outside the box AND they are moving away from it
 * (or standing still). Inbound bullets are never culled, so attacks can start off screen.
 */
export const DESPAWN_MARGIN = px(48);
/** Safety cull: any bullet this far from the box center goes, whatever its direction. */
export const FAR_CULL_DISTANCE = 2400;
/**
 * The visible play area in world coordinates (the 1280x720 layout; same as VIEW in render/theme).
 * Edge attacks spawn beyond it and travel in.
 */
export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 720;
/** Extra distance past the screen edge (beyond the bullet's own size) for off-screen spawns. */
export const OFFSCREEN_PAD = px(4);
/** Spawn scale-pop duration (s). Draw AND hitbox scale together during it. */
export const SPAWN_POP_TIME = 0.08;
/** Despawn fade duration (s). Visual-only ghost; no collision. */
export const DESPAWN_FADE_TIME = 0.12;
/** Hit feedback. Shake intensity is a fraction of the view, so it needs no scaling. */
export const HIT_SHAKE_MS = 90;
export const HIT_SHAKE_INTENSITY = 0.006;
export const HIT_FLASH_MS = 70;

/** Timer mode: seconds to survive to win. */
export const TIMER_DURATION = 120;
/** Scene transition fade (ms): short and punchy. */
export const SCENE_FADE_MS = 140;
