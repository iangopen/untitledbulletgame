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
/** Speed multiplier while Space is held (slow movement). */
export const SLOW_MULTIPLIER = 0.45;
/** Soul radius in px (was 6). Drawn circle and collision circle are both exactly this. */
export const SOUL_RADIUS = px(6);

/** Dash (active ability, Shift): distance (a third of the default box width), duration, cooldown. */
export const DASH_DISTANCE = px(300) / 3;
export const DASH_DURATION = 0.12;
export const DASH_COOLDOWN = 3;
/** I-frame rule: a dash grants i-frames for exactly its duration (never shortens running i-frames). */
export const DASH_IFRAMES = DASH_DURATION;
/** Trail fade after the dash ends (visual only). */
export const DASH_TRAIL_FADE = 0.16;

// --- Actives (one equipped, on Shift). Every number here. ---
/** Shield: a bubble that absorbs the next damaging hit (any type, damaging walls too) or expires. */
export const SHIELD_DURATION = 2.0;
export const SHIELD_COOLDOWN = 8;
/** I-frames granted when the shield breaks, so the same bullet can't hit on the next step. */
export const SHIELD_BREAK_IFRAMES = 0.4;
/** Slow time: everything except the soul (bullets, boxes, character timers, hazards) runs at this rate. */
export const SLOWTIME_SCALE = 0.45;
/** Real seconds the slow lasts. */
export const SLOWTIME_DURATION = 2.5;
export const SLOWTIME_COOLDOWN = 12;
/** Blink: an instant teleport this far in the held direction (screen-relative), clamped into the soul's box. */
export const BLINK_DISTANCE = px(70);
export const BLINK_COOLDOWN = 4;
/** Seconds the blink flash (start and end markers) fades over (visual only). */
export const BLINK_FLASH_TIME = 0.22;

// --- Passives (one equipped, applied once at battle start). ---
/** Thick skin: max HP multiplier. */
export const THICK_SKIN_HP = 1.25;
/** Afterglow: i-frames after a hit (s), instead of IFRAME_DURATION. */
export const AFTERGLOW_IFRAMES = 1.5;
/** Quick charge: active cooldown multiplier. */
export const QUICK_CHARGE_COOLDOWN = 0.75;
/** Steady: slow movement multiplier, instead of SLOW_MULTIPLIER. */
export const STEADY_SLOW_MULTIPLIER = 0.6;

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
 * Bullets despawn once their WHOLE shape is outside the screen AND they are not heading toward the
 * box (BulletPool.offScreen), so nothing vanishes while partly visible and inbound bullets are kept.
 */
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
/** Seconds a new (on-screen) bullet takes to fade in at full size. Visual only. */
export const SPAWN_FADE_TIME = 0.1;
/** Longest fade-in of a forming (gold, growIn) bullet; shorter gold times fade over the whole gold time. */
export const GOLD_FADE_TIME = 0.4;
/** Shine at the pre-active -> active moment (s): a gameplay cue, drawn whatever the flash setting. */
export const SHINE_TIME = 0.12;
/** Despawn fade duration (s). Visual-only ghost; no collision. */
export const DESPAWN_FADE_TIME = 0.12;
/** Hit feedback. Shake intensity is a fraction of the view, so it needs no scaling. */
export const HIT_SHAKE_MS = 90;
export const HIT_SHAKE_INTENSITY = 0.006;
/** A tossed box landing (The Warden): a short, heavier shake. */
export const LAND_SHAKE_MS = 140;
export const LAND_SHAKE_INTENSITY = 0.01;
export const HIT_FLASH_MS = 70;

/** Timer mode: seconds to survive to win. */
export const TIMER_DURATION = 120;
/** Scene transition fade (ms): short and punchy. */
export const SCENE_FADE_MS = 140;
