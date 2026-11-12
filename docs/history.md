# History

## 2026-11-11 — Phase 1 "Feel"
Scaffolded Vite/TS/Phaser; Clock, Box, Soul, Collision with tests; temp spawner; HP/KR HUD.
Found during browser check: Phaser's smoothed `delta` slowed the sim under low frame rates; switched to `performance.now()` deltas.
Browser automation window throttles rAF, so verification drove `game.loop.step` manually with a fake clock.

## 2026-11-11 — Phase 2 "Bullet system"
Bullet/BulletPool/patterns, World + BattleView split, JSAB-style restyle, exact hitboxes, dev hitbox overlay, DebugScene, Pages deploy workflow.
Bug fixed during tests: the wall hook missed bullets in their first step (stored inside flag); now computed from pre-move position.
DebugScene initially leaked into the prod bundle via a static import; now a DEV-only dynamic import.

## 2026-11-11 - Phase 3 "Characters + Prism"
EventBus, config resolver/validator, Character base, registry, Prism L0-20, temp runner with ?prism= and [ ] keys, Node-24 Pages actions.
Tests caught Prism difficulty dropping at band edges (volley cooldown 1.8 -> 1.9 at L5->L6, beam slower at L15); bands now continue from the previous band's end values.
Browser screenshots time out while the Phaser loop is asleep; wake it with a frozen fake clock to capture without advancing the sim.

## 2026-11-11 - Phase 4 "Director + loop"
Director, TimerMode, interactions hub, plain-data roster; Menu, Roster, Battle HUD/pause, Results; ?roster= shortcut replaces ?prism=; dev-only ?duration=.
Fixed during browser check: nudge() killed a running pop tween and left a roster card stuck at 1.04 scale; nudge now restores scale. Pause overlay hint overlapped the HP bar; moved up.
Each commit verified to build on its own (rule added to CLAUDE.md).

## 2026-11-11 - Phase 5 "Dynamic box"
Box tracks (size/position/rotation) on the fixed step, squeeze with anchor and content shift, min size clamp, damaging walls via Soul.damage, box/wall events, DebugScene box controls.
Gotcha: editing a CRLF file with Python str.replace silently missed multi-line matches, and writing with the default Windows encoding turned a new degree sign into a lone cp1252 byte. Use the Edit tool, or open files with encoding='utf-8' and normalise newlines.

## 2026-11-11 - Visual pass
1280x720 view at device resolution, WORLD_SCALE 1.5 gameplay scaling, Inter + JetBrains Mono self-hosted, minimal restyle of every screen.
Found: #game flex centering plus Phaser CENTER_BOTH double-centered the canvas (the "roster off-center" complaint). Resize handler moved from rAF to a timer debounce plus ResizeObserver plus scale.refresh(), because container resizes don't trigger Phaser's refit.

## 2026-11-11 - Smooth motion
F3 performance overlay (every build), render interpolation (snapshot at step start, blend by clock.alpha, snap on jumps/flips, alpha 1 with the hitbox overlay).
Measured before changing: draw cost was ~1 ms/frame even at 2520x1418 with Prism 20, so the sprite rewrite and resolution cap were skipped; judder came from 0/1 steps per frame at 120/144 Hz with no interpolation.
The automation browser throttles rAF (~13/s) even in a visible tab, and awaiting inside a JS tool call stalls frames further; benchmark by calling game.step() synchronously with gl.readPixels to sync the GPU.

## 2026-11-11 - Settings
Settings screen (menu and pause), frame-rate caps as whole divisors of the measured refresh, render quality caps, Show FPS, shake/flash gate, versioned storage key ubg.settings.v1.
Found: Phaser emits 'ready' before loop.start(), which replaces the loop callback; the limiter intercepts loop.start instead. Using performance.now() for draw gating let a late callback shift a draw by a tick; the rAF timestamp fixed it. Phaser's keyboard queue replays earlier presses within one step; it is now emptied after each DOM event.
Process slip: a stash-based pre-commit check conflicted on a partially staged file and a bad commit landed locally (never pushed); undone with reset --soft. Verify staged trees by exporting the index (git checkout-index) to a scratch dir with a node_modules junction instead of stashing.

## 2026-11-11 - Projectile types, off-screen spawns, profile boxes
Projectile kinds (white/blue/orange/KR) decided in combat/projectile.ts from Soul.moving; Prism all white; attacks start off screen and are planned ahead to keep their beat (Character base Shots + attackStarted); constant 33 px volley spacing; profile boxes; input ignored during fades.
Found: the bullet layer's geometry mask hid the off-screen approach, so it was removed. Battle start planning can spawn two rows in one step (their leads exceed the time left); arrivals still keep a full cooldown apart, which broke an old test that assumed a 0.81 s spawn.

## 2026-11-11 - The Warden, world-fixed bullets, visual tweaks, texture prewarm
Added The Warden (slot 4): punch (decor fists shove the box with Box.moveTo, a return punch brings it home) and spin (Box.rotateTo swings). Bullets became world-fixed so a moved box runs into attacks; spawns follow the box at fire time. Spins are limited to ~25 deg because a turned 450x330 box crosses the HUD bands. Visual tweaks: fade-in instead of spawn pop and grow-in, six-armed snowflakes, wider axe head, blue toward cyan, violet refraction prism. Every look is prewarmed at battle start (0 builds mid-battle). Fixed along the way: Prism's pre-fired opening volley in the top band, Prism rays planned against a stale box, rows on a turned edge starting partly on screen, a spin stalling after two reversals.

## 2026-11-11 - Multi-box World and The Warden's rip
world.boxes + world.box (the soul's box), split/merge/reset with reframing, per-box wall hooks, boxSplit/boxMerged. The Warden rips the box (L15+), merges it offset with a punch and re-centers it. Fixed: punch returns used a merged box's off-center defaults; DebugScene merge needed the inactive tick to check for the merge.

## 2026-11-11 - Ember, toss-and-spin, Box.scaleTo
Ember (slot 5, orange support: embers, fire sweep, wildfire rings) completes the five launch characters. The Warden's swing became a toss: Box.scaleTo shrinks the box (soul scales with it), it spins whole turns while small and lands with a shake (boxLanded). New 'ring' bullet shape drawn as stretched line chords. No new combos (Ian designs them).
Found: the soul disc texture was keyed by radius (45 mid-battle builds once the soul scaled); sweep and gust off-screen offsets were planned before a toss and started in a HUD band. Fast-forwarding the sim in one real frame leaves despawn ghosts on screen; clear view.ghosts before screenshots.

## 2026-11-11 - Box slides under the soul, gentler toss, Ember fire visuals
After play-testing: box moves, turns, resizes and toss scales keep the soul's world position (only walls that reach it push it); the soul never scales; the toss bottoms out at 0.80 (was 0.5). Ember's embers, sweep walls and rings are flame shapes (ring tongues share geometry for drawing and collision), flicker is alpha only, and a blinking fire icon warns 0.6 s before each ring.
Screenshot tooling: freezing game.loop mid scene-fade leaves the camera dimmed; reset cameras.main.fadeEffect before capturing.

## 2026-11-12 - Abilities and the loadout picker
Actives shield, slow time (world.timeScale; the soul and battle timer stay real-time), blink; passives thick skin, afterglow, quick charge, steady through one equipLoadout hook; roster loadout picker saved under ubg.loadout.v1; results show the loadout. Vitest timeout raised to 20 s after two heavy simulations timed out under load.
Screenshot tooling: freezing the loop also freezes a running camera flash; reset flashEffect and fadeEffect before capturing. Roster keys pressed during the scene fade are ignored by design; wait for the fade.
