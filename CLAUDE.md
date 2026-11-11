# CLAUDE.md — Bullet-Hell Game

Living architecture contract. Update at the end of every session: what's real (built and verified) vs. still open.

## What this is
Keyboard-only bullet-hell. The player dodges as a soul inside a box (Undertale-style dodging only, no ACT/menus in battle). A UCN-style roster: the player sets each character's level 0–20 and all active characters attack at once. Geometric/minimal art. Personal hobby project.

## Stack
- TypeScript (strict), Phaser 3, Vite
- No physics engine: collision is hand-written shape math in `src/combat/Collision.ts`
- Vitest for pure logic; rendering verified in the browser
- Save: versioned JSON in localStorage
- Build gate: `npm run build` must pass (not just `tsc`)

## Commits
- Every commit must build and pass tests on its own (`npm run build` and `npm test` on exactly the staged tree). Order commits so dependencies land first; check with `git stash push --keep-index --include-untracked` before committing, then `git stash pop`. (Phase 3's first commit did not build; don't repeat that.)

## Commands
- `npm run dev`: dev server
- `npm run build`: production build (the gate)
- `npm test`: Vitest

## Architecture rules
1. Characters never import or reference each other. They communicate only through typed events on `core/EventBus.ts` (one bus per World, `world.bus`). Events so far: `beamFired`, `beamHitWall`, `beamRefracted` (Prism), and `boxResized`, `boxMoved`, `boxRotated` (on each request, with target and duration), `wallStateChanged`, `wallHit` (Box/World). Every event and its payload is declared in `GameEvents` there; add new events to that interface, never use untyped strings. Handlers run synchronously on emit. Combos live only in `director/interactions.ts`, so adding a character never edits existing ones.
2. The Box is the coordinate frame. Bullets store box-local positions; `Box.toWorld` / `toLocal` convert. Moving, resizing or rotating the box transforms everything inside it.
   Box API (`core/Box.ts`; all motion advances in `box.step(dt)` on the fixed step, never Phaser tweens, so it is frame-rate independent and freezes on pause):
   - `resizeTo(w, h, duration, ease, anchor = 'center' | wall)`, `squeezeWall(wall, amount, duration, ease)` (the opposite wall stays fixed), `moveTo(x, y, duration, ease)`, `rotateTo(rad, duration, ease)`, `rotateBy(delta, ...)`, `setWall(wall, { damaging, damage, type })`, `reset()`, plus `state`, `defaults`, `walls`, `moving`, `distanceToWall`, `dirToLocal`.
   - Easings are monotonic only (`linear`, `quadIn`, `quadOut`, `quadInOut`, `cubicOut`, `sineInOut`), so a tween never overshoots its clamped target.
   - Minimum size `BOX_MIN_WIDTH`/`BOX_MIN_HEIGHT` (60x60, tuning.ts). Every resize and squeeze is clamped to it.
   - **Arbitration rule (for Phase 6 combos):** size, position and rotation are three independent tracks that run at the same time. A new request on a track replaces the running one, starting from that track's current value (no snapping). Position applies as a per-step delta, so it composes with the center motion of anchored resizes.
   - Anchored resizes report `box.contentShift`; World applies it to the soul and bullets so a squeeze doesn't drag things the wall hasn't reached.
   - **Soul-in-box defaults (Ian may change):** the soul lives in box-local space and rides with the box when it moves or rotates. Controls are screen-relative (input is rotated into box space). Every step the soul is clamped to the interior, so a moving wall pushes it inward and it can never be outside, even after an instant squeeze.
   - Damaging walls: contact means the soul is within `WALL_CONTACT_EPS` (0.5 px) of being pressed against a damaging wall. Contact goes through `soul.damage`, so i-frames and KR apply as usual. Drawn thick amber (`theme.wallDamaging`), or magenta when the wall deals KR. Never red.
   - Bullet wall hooks are checked in box-local space against the current size, so they fire where the wall really is while it moves, rotates or resizes. A shrinking wall that sweeps past a bullet also counts as a crossing.
   - Each battle builds a new World, so the box starts at its defaults on every battle and retry.
3. Characters are config plus a small class. `<name>.config.ts` maps level bands to attacks, damage, speed, frequency. The class only holds behavior the config can't express. Level 0 = inactive.
   Config format (`characters/config.ts`):
   - `bands: [{ from, to, attacks: { <attackId>: { <param>: [atBandStart, atBandEnd] } } }]`, covering 1..maxLevel with no gaps.
   - `resolveLevel(cfg, level)` interpolates every param linearly within the level's band. `count` and `gapSize` round to integers. A one-level band uses its start value.
   - Every attack needs a `cooldown` (seconds between shots). Higher bands must re-list every lower attack (enforced by `validateConfig`, tested for every shipped config), so "keeps lower attacks" is explicit data. Difficulty must not drop at band edges (also tested).
   - `rules`: non-level constants (limits, sizes, design defaults).
   - `Character` (base) resolves on `setLevel`, runs one timer per enabled attack on the fixed step, and calls the subclass's one-method-per-attack map. It owns a seeded RNG so sequences are reproducible. `registry.ts` lists characters by id; the runner and Director use only `CharacterHandle`.
4. The Director owns battle time and ticks every active character's schedule. Modes (`TimerMode`, `WaveMode`) only decide when the battle ends or what loads next.
   - `director/Director.ts`: `new Director(world, roster, mode)` creates only characters with level > 0 (from `registry`), installs `interactions` for the active set, and on each `step(input, dt)` ticks characters, steps the World, advances `time`, and asks the mode. When the mode answers it sets `outcome` = `{ result: 'win' | 'loss', mode, time, hp, maxHp, roster }` and freezes.
   - `director/modes/Mode.ts`: `BattleMode { id, label, evaluate({ time, soulAlive }) -> 'win' | 'loss' | null, hud(state) -> string }`. `TimerMode(duration = TIMER_DURATION)` wins at the target time; HP 0 loses, and death wins a tie.
   - `director/interactions.ts`: the only place for cross-character combos. Each rule is `{ id, requires: [ids], install(bus, world) -> unsubscribe }`, and is installed only when every required character is active. Empty until Phase 6.
   - `director/roster.ts`: a `Roster` is plain data (`{ [id]: level }`), copied between scenes, never a live object, so retry always starts clean.
5. All damage goes through `soul.damage({ amount, type })`. i-frames and KR poison are handled there and nowhere else.
6. Game logic runs on a fixed 60 Hz timestep, separate from rendering, so difficulty is frame-rate independent.
7. Collision, config lookup, damage, scheduling and battle outcome are pure (no Phaser) with unit tests. Phaser code only draws and reads input.
8. Bullets come from `BulletPool`; never `new Bullet()` inside the game loop.
9. Colors come from `render/theme.ts`. Each character owns one accent color; bullets must stay readable against the box at all levels.
10. Exact hitboxes: what you see is what hits you. Every collision shape equals its drawn shape and size. Drawing and collision both derive from the same geometry functions in `combat/Bullet.ts` (`bulletCircle`/`bulletRect`/`bulletTriangle`), and the soul's drawn radius is its hit radius. Never add a separate "hitbox size". The spawn pop scales both together; despawn fades are visual-only ghosts that never collide.
11. Visual style (in the spirit of Just Shapes & Beats): near-black background, flat bright solid shapes with crisp edges, no textures or images, thin clean lines, lots of empty space, one accent per screen. Motion is short and punchy: quick scale-pop on spawn, fast fade on despawn, brief flash and small shake when the soul is hit, 140 ms scene fades.
    - Resolution: every scene lays out in a fixed 1280x720 virtual view (`VIEW` in theme.ts). `render/display.ts` sizes the canvas to the real device pixels it occupies (fit-to-container x devicePixelRatio) and each scene's camera zooms the view to fit (`applyView`, called by `enter()`). Nothing is CSS-upscaled, so it stays sharp at any window size or DPI; text is rasterised at the same scale and re-rasterised on resize. Phaser `Scale.FIT` + `CENTER_BOTH` does the centering; the `#game` container must not also center (that double-centered the canvas before).
    - Never lay out with `this.scale.width/height` (that's device pixels); use `VIEW`.
    - Typography: one UI face, Inter (self-hosted via `@fontsource/inter`, latin 400/600), and JetBrains Mono (`@fontsource/jetbrains-mono`) only for numbers (levels, timer, HP, stats). Fonts load before the game boots. Sentence case or lowercase; no all-caps labels.
    - Scales in `theme.ts`: `type` (hint 15, small 17, body 22, label 26, number 44, title 64), `space` (xs 6, sm 12, md 24, lg 48, xl 96), `line` (thin 2, box 2, danger 6). Colors: `text`, `textDim` for secondary, `textMuted` for hints, `locked` for placeholders.
    - Screen patterns: selection = full brightness plus a small red dot (menus) or a thin accent underline (roster); everything else dims. One quiet controls line at the bottom (`hint()`). No boxed cards or panels.
    - Gameplay sizes are separate from UI sizes: `tuning.ts` writes every gameplay distance, size and speed as `px(original)` with `WORLD_SCALE = 1.5` (720/480), so the game feels exactly as it did at 640x480.
12. Red belongs to the player (solid red circle). Hazards never use red. Generic bullets are white; KR is magenta.
13. Characters customise bullets through `onStep`/`onWall` hooks and compose `combat/patterns/` (line, fan, ring, aimed), not through Bullet subclasses or hand-written spawn loops.
14. Render interpolation: logic and collision use the simulated state; drawing uses the interpolated state. `World.step` first calls `world.snapshot()` (box, soul and every active bullet record `prev`/`px,py,prot`), and `BattleView.draw(realDt, alpha)` blends prev -> current by `clock.alpha` (leftover step fraction) through `render/interp.ts` (`BoxFrame`, `lerpPoint`, `lerpAngle`). Never read `prev` in game logic. Spawns and resets start with prev == current; a jump over `SNAP_DISTANCE` or a turn over `SNAP_ANGLE` in one step draws at the current state (teleports, bounces). Pause holds alpha still (no jump); a frozen battle re-snapshots so it draws its final state. The hitbox overlay forces alpha 1, so with it on, drawn shapes are bit-identical to collision shapes. New moving things must add their state to `snapshot()` and draw through the blend. Never change game speed with rAF tricks: game time comes only from the fixed step.

## Rendering and performance
- Drawing is Phaser Graphics (WebGL) rebuilt each frame: box, bullets (geometry-masked to the box), soul, overlay, HP bar. Measured cheap: about 1 ms median per frame including GPU work at Prism 20 on a 2520x1418 canvas, so it was kept rather than moved to pooled sprites, and there's no render-resolution cap. Revisit if a character pushes bullet counts into the hundreds (the Phase 2 stress test showed ~13 ms at 900 bullets).
- F3 toggles the performance overlay in every build (`ui/PerfOverlay.ts`, stats in `render/frameStats.ts`): fps, display frame interval, steps per frame, CPU frame time (median/p99/max) with a 120-frame graph (guides at 8.3 and 16.7 ms), dropped frames (interval over 1.5x median), bullets, devicePixelRatio. `window.__perf` exposes it. Frame time is CPU-side; GPU stalls show as longer intervals.
- Benchmark method (the automation browser throttles rAF to ~13/s): sleep `game.loop`, then call `game.step()` in a tight loop with `__battle.loop.last` set one step back (one sim step per frame) and `gl.readPixels` of 1 px after each frame to include GPU time.

## Pixel ratio and HTML UI layer
- Pixel-ratio rule: the canvas backing store is always displayed CSS size x devicePixelRatio (`render/display.ts`); re-fit on window resize, host resize and ratio changes (matchMedia). The camera maps the 1280x720 layout onto it. Dev-only `?dpr=1.5` fakes the ratio for testing.
- All UI text (menu, roster, HUD, pause, results) is DOM in `src/ui` (UiLayer + styles from theme tokens), not Phaser text, which blurred under fractional zoom with LINEAR filtering. The overlay copies the canvas rect exactly. Only the dev DebugScene still uses Phaser text.
- Input rules: scenes own state; the DOM only renders and forwards input. Hover and keyboard share one selection index per screen. Mousedown and wheel are prevented on the overlay, so clicks never take focus or scroll the page. Locked items use a not-allowed cursor and ignore the mouse. Battle movement stays keyboard-only; a quiet "pause" button gives a mouse route.

## Scene flow
`Menu` (Timer mode; Wave mode shown as coming soon) → `Roster` (5 UCN-style slots: Prism plus 4 locked placeholders; ←/→ pick a slot, ↑/↓ change level, Z sets all to 0, X sets all to 20, Enter fights, Esc returns to the menu; shows total difficulty) → `Battle` (Director + TimerMode; HUD shows the countdown, HP/KR bar and roster summary; Esc pauses: resume / restart / quit to roster) → `Results` (win/loss, time survived, HP left, levels; R or Enter retries the same roster, Esc goes to the roster with levels kept).
Transitions are 140 ms fades (`SCENE_FADE_MS`) via `scenes/ui.ts` `go()`/`enter()`, and every screen follows the visual rules (rule 11). Pause skips the fixed step and `FixedLoop.resync()` on resume, so no time is caught up.

Dev shortcuts:
- `?roster=prism:12` (comma-separated `id:level`, clamped, unknown ids ignored) skips the menu straight into battle. It applies once per page load and works in production too.
- `?duration=<s>` shortens timer mode. Dev builds only; it's stripped from production.
- In dev: H toggles the hitbox overlay; backtick opens DebugScene.
- Every build: F3 toggles the performance overlay.

## Folder layout
```
src/
  main.ts
  scenes/      Menu, Roster, Shop, Battle, Results
  core/        Soul, Box, Clock, EventBus
  combat/      Bullet, BulletPool, Collision, patterns/
  characters/  Character (base), registry, <name>/ (class + config)
  director/    Director, interactions, modes/ (TimerMode, WaveMode)
  abilities/   passives/, actives/
  data/        save
  render/      theme (palette + UI scales + VIEW), display (crisp DPR scaling), BattleView
```

## Locked game decisions
- Two modes, both time-based: fixed survival timer, and a scripted set of waves
- HP bar with i-frames; KR-style poison as a damage type; no one-hit mode; no healing pickups
- Shop: one passive and one active ability equipped; unlocks are abilities and cosmetics, never characters
- 5 characters at launch; Prism is #1; the rest are designed with Ian, not invented by Claude
- Keyboard only; no music yet; scoring decided later

## Characters
### Prism (cyan triangle): pure dodging, no box effect (built in Phase 3)
- Files: `characters/prism/prism.config.ts` (all numbers and rules) and `Prism.ts` (one method per attack).
- Levels 1-5, `volley`: a row of small cyan triangles (pointing along travel) from one edge, never the same edge twice in a row, with a contiguous gap. L1: 8 slots with a 3-gap, 70 px/s, every 2.6 s, 4 dmg. L5: 10 slots with a 2-gap, 95 px/s, every 1.8 s, 6 dmg.
- Levels 6-14, adds `beam`: thin cyan beams (length 34-40, thickness 4) enter from a random edge at up to +/-20 degrees off the inward normal. When an original beam's center leaves through a wall, it splits into two gen-1 beams reflected off that wall, spread by `splitSpread`. Gen-1 beams never split again (`rules.splitMaxGeneration = 1`, tunable; raising it grows bullet counts exponentially).
- Levels 15-20, adds `prism`: a large translucent cyan triangle (radius 28) inside the box, relocating every 9 to 6 s. Any Prism beam whose center enters it is replaced by exactly 3 beams fanned by `refractSpread`. Refracted beams carry the REFRACTED flag and ignore prisms, so there are no loops. By default they don't split at walls (`rules.refractedCanSplit = false`). 50-70% of beams aim through the prism. DESIGN DEFAULT Ian may change: the prism is harmless to touch (`rules.prismHarmless`; it is a World prop, not a bullet).
- Emits `beamFired` (every beam, with gen), `beamHitWall` (wall, gen, split), and `beamRefracted` (count).

## Build order
1. Feel: scaffold, fixed timestep, soul movement, static box, test bullet, collision, HP + i-frames
2. Bullet system: pool, shapes, box-local coords, line/fan/ring/aimed patterns, debug spawn scene
3. Prism end to end: Character base, config format, registry
4. Director + Timer mode: roster toggles, battle start/end, results
5. Dynamic box: tweened resize/move/rotate, damaging walls, change events
6. Characters 2–5 + interactions
7. Wave mode
8. Shop, abilities, save
9. Polish and scoring

## Status
Live: https://iangopen.github.io/untitledbulletgame/ (full loop: menu → roster → battle → results; `?roster=prism:12` jumps straight into a battle). Deployed by `.github/workflows/deploy.yml` on every push to main: npm ci, npm test, npm run build, then Pages. Actions are pinned to Node-24 versions (checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5).

### Real (built and verified)
**Phase 1 (Feel):** fixed 60 Hz Clock fed by `performance.now()`; Box with rotation-ready `toWorld`/`toLocal`; Soul with 8-way and slow movement, HP, i-frames, and KR (drains 8 HP/s through i-frames, KR hits respect and grant i-frames, can't drop HP below 1; unchanged).

**Phase 2 (Bullets):** Bullet (circle/rect/triangle/beam; hooks; `gen`/`flags`/`color` fields), BulletPool (1024, graceful overflow), patterns line/fan/ring/aimed, exact hitboxes from shared geometry, JSAB-style BattleView with spawn pop, despawn ghosts, hit flash and shake, dev hitbox overlay (H), dev DebugScene (backtick).

**Phase 3 (Characters + Prism):**
- `core/EventBus.ts` (typed), `characters/config.ts` (resolver and validator), `Character.ts`, `registry.ts`, and Prism at levels 0-20 as described above. World now has `bus` and `props` (non-damaging, drawn translucent).
- Tests: 88 Vitest cases, including the resolver at band edges and midpoints, config validation, Prism band membership, difficulty never dropping across levels, split-once, refraction into exactly 3, level 0 spawning nothing, and level 20 bounded over 60 s.
- Browser-verified (30 s per level, soul invincible): L0 nothing; L1 volleys every 2.5 s; L5 every 1.9 s; L6 volleys every 1.8 s plus beams every 3.0 s; L10 volleys 1.5 s plus beam pairs 2.7 s; L14 volleys 1.3 s plus beam pairs 1.8 s; L15 adds the prism (4 relocations, 24 refractions); L20 volleys 1.0 s, beam triples 1.4 s, 48 refractions, peak 45 bullets. Traced: a beam split at a wall; its children left through walls with split=false; a prism refraction produced exactly 3 beams that exited without splitting.
- Perf at level 20 (overlay off, 4 runs of 35-40 s): peak 42-46 bullets, median frame 0.2 ms, sim step at most 2 ms. 0-2 frames per run went over 16.7 ms (worst 36.9 ms), at random moments, in Phaser render or draw rather than the sim, which looks like GC or browser pauses.

**Phase 4 (Director + loop):**
- Director, BattleMode interface, TimerMode (120 s default, `TIMER_DURATION` in tuning.ts), interactions hub (empty), plain-data roster with the `?roster=` parser. MenuScene, RosterScene, BattleScene (HUD and pause), ResultsScene. The temporary runner, `?prism=` and the dev [ ] keys are gone; levels are set on the roster screen.
- Tests: 102 Vitest cases. New ones cover the Director (level-0 characters not created or ticked, win on timeout, loss on death with time survived, freeze after the outcome, roster copied), TimerMode (edges, death beats the timer, clock format), interactions install/dispose, and roster parsing.
- Browser-verified: menu (Wave mode can't be chosen and just nudges), roster (Prism 1→12 with ↑, ↓ works, clamps at 0 and 20, X/Z set all, locked slots stay 0), battle HUD countdown, pause freezing time and bullets with no catch-up on resume, quit to roster keeping levels, loss (DOWN, 0:03.3, 0/100, Prism 12), win with dev `?duration=6` (SURVIVED, 0:06.0, 94/100, Prism 5), retry starting fresh (100 HP, 0 KR, 0 bullets, outcome cleared, same roster), and the `?roster=` shortcut. No console errors.

**Phase 5 (Dynamic box):**
- Box API as described under rule 2. Damaging walls, the `wallHit` event, the box events, per-wall rendering, and the HUD anchored to the default box position. DebugScene box keys: Q/E rotate ±30°, R +90°, T +180°, F resize, G move, V fast squeeze left, B slow squeeze right, N cycle wall states, M continuous motion, P Prism 0/20, Z reset; the readout shows box size, position, rotation and wall states.
- Tests: 125 Vitest cases. New ones cover rotation round-trips, `dirToLocal`, simultaneous tracks, replace-from-current, `rotateBy` accumulation, the min-size clamp, squeezes keeping the opposite wall world-fixed even when rotated, reset, events, soul push-in (slow, and instant to min size), world-fixed contents during a squeeze, riding the box, screen-relative controls, damaging walls (once, then i-frames; KR goes to the pool), and wall hooks in a rotated, resized box.
- Browser-verified in DebugScene: resized and 30°-rotated boxes with bullets, and amber/KR damaging walls. Slow squeeze: the soul pressed at x=144 was pushed to x=104 and never got closer than 6.0 px (its radius) to the wall. Fast squeeze (80 px in 0.12 s): the wall went from world x 170 to 250 and the soul from 220 to 256, never closer than 6.0 px. Instant 2000 px squeeze clamped to width 60 with the soul inside. A damaging wall hit at t=5.88 and t=6.88 (i-frames blocked 105 contacts in between). Prism 20 with the box spinning through 782° and breathing between widths 208 and 300 for 40 s: 244 wall events, all 0 to 3.25 px past the real wall (at most one step of travel), 23 splits; peak 43 bullets; frame median 0.3 ms, p99 2.9 ms, 2/2400 frames over 16.7 ms (same rare render-side spikes as before). Pause froze box motion for 3 s; resume continued without a jump; retry restored the default box and safe walls.
- Normal play is unchanged: no character moves the box yet.

**Visual pass:**
- 1280x720 virtual view, rendered at device resolution with camera zoom (canvas pixels = displayed pixels; e.g. 1680x945 canvas at 1680x945 CSS in a 1920x945 window), refitted on window or container resize. The canvas is centered exactly (it used to sit 60 px right because of double centering).
- Gameplay scaled by WORLD_SCALE 1.5 (old -> new): soul speed 170 -> 255 px/s, soul radius 6 -> 9, box 300x220 -> 450x330, min box 60x60 -> 90x90, despawn margin 48 -> 72, wall contact 0.5 -> 0.75, Prism volley 70-145 -> 105-217.5 px/s, beam 130-200 -> 195-300 px/s, beam length 34-40 -> 51-60, volley size 6 -> 9, beam thickness 4 -> 6, prism radius 28 -> 42, spawn offsets 10/12/20 -> 15/18/30, default bullet radius 6 -> 9. Timings, damage, HP, i-frames and KR are unchanged. Crossing the box still takes 300/170 = 450/255 = 1.76 s.
- Restyled menu, roster (no cards: shape, name, level; selected bright with an accent underline; locked = faint outline + "locked"), battle HUD (mono countdown, thin HP bar, quiet hint), pause (hides the battle hint, red dot marker), results (one accent word, two-column stats).
- Browser-verified at 1920x945 and in an emulated 1920x560 wide container: every screen centered (canvas center equals container center), text crisp; hitbox overlay still exact at zoom 1.313; no console errors. Tests: 125 passing (one test was coupled to the old soul radius and now uses SOUL_RADIUS).

**HTML UI + pixel ratio:** diagnosed the backing store was already CSS x DPR (1680x945 / 2100x1181 / 2520x1418 at 1 / 1.25 / 1.5); the blur was Phaser text textures resampled at fractional positions. UI moved to DOM; mouse and keyboard loops verified locally; overlay aligned exactly at ratios 1/1.25/1.5 and narrow/wide hosts; DebugScene rescaled by 1.5. Ratios were emulated (`?dpr=`), not real browser zoom.

**Smooth motion (interpolation + F3 overlay):**
- Diagnosis: draw cost was not the problem; missing interpolation was. Bench (1800 frames = 30 s of game time, one step per frame, GPU-synced, ms per frame; before -> after interpolation):
  - Soul only, ratio 1 (1680x945): median 0.80 -> 0.60, p99 9.2 -> 2.6, frames over 16.7 ms 9 -> 2
  - Prism 20, ratio 1: median 1.20 -> 1.80, p99 10.6 -> 7.0, over 16.7 ms 8 -> 6, peak 43 bullets
  - Soul only, ratio 1.5 (2520x1418): median 1.30 -> 0.90, p99 5.8 -> 8.6, over 16.7 ms 7 -> 9
  - Prism 20, ratio 1.5: median 1.10 -> 1.20, p99 5.2 -> 4.6, over 16.7 ms 5 -> 5
  The differences are run-to-run noise; spikes (24-45 ms) happen with zero bullets too, so they're browser pauses, not drawing. Headroom: about 1-2 ms of an 8.3 ms (120 Hz) budget.
- Pacing (pure test with the real Clock and World): steps per frame at 60 Hz are always 1; at 120 Hz 0 or 1 (50/50); at 144 Hz 0:41 and 1:29 of 70 frames. Without interpolation the soul drew 0 or 4.25 px per frame at 120/144 Hz (the judder); with it, exactly 2.125 px (120 Hz) and 1.771 px (144 Hz) every frame, and proportional to real time under +-1 ms jitter.
- In the browser with 144 Hz frame pacing: the drawn soul advanced exactly 1.771 px per frame; pause held it still for 3 frames and resume continued with the same spacing (no jump); retry starts with a new world, alpha 0 and prev == current; 364 spawns at Prism 20 (with splits and refractions) all drew at their spawn state. Paused with H on: the interpolated box frame equals the simulated box exactly, and the soul outline sits on the soul. No console errors.
- Tests: 139 (stats ring buffer, pacing at 60/120/144 Hz and with jitter, no smearing on spawn/teleport/flip/reset, bit-exact at alpha 1, identical simulation with or without snapshots). All earlier hitbox tests still pass.

### Open
- Vsync-paced numbers on a real 120/144 Hz display were not measured: the automation browser throttles rAF to ~13/s. Ian should check with F3 on his laptop (expect steps/frame about 50% 0 and 50% 1 at 120 Hz, and frame ms well under 8 ms).
- Ratio 1.5 was emulated with `?dpr=` (dev only), not real browser zoom; at an emulated ratio on a 1x screen the 1-device-pixel hitbox hairline is too faint to inspect in screenshots, so overlay alignment is shown numerically.
- Confirm sharpness on Ian's real Windows 125/150% display (only emulated here)
- Real browser-window resizing wasn't tested (the automation window wouldn't resize); container resizing was
- Rare 25-45 ms frame spikes (with or without bullets): browser/GC pauses in the automated browser; profile in a normal browser if F3 shows them on Ian's machine.
- DebugScene draws without interpolation (alpha 1); fine for a dev tool.
- Despawn ghosts and props (the refraction prism) aren't interpolated: ghosts are static and the prism only teleports.
- Prism numbers are first guesses; tune by feel. Open design calls: prism harmless?, refracted beams split?, prism relocation rate.
- KR rules (i-frames on KR hits, non-lethal), Ian deciding; Prism deals no KR.
- No character uses the dynamic box yet (Phase 6). The defaults to confirm: soul rides the box, controls screen-relative, wall damage 5 per contact, min box 60x60
- Box events fire on request (target + duration), not on completion; add completion events if combos need them
- Wave mode (Phase 7): the menu shows it as coming soon; it needs a `BattleMode` that also loads waves
- Scoring; results show time, HP and levels only
- In-battle level changes for tuning were dropped with the [ ] keys; use the roster screen or `?roster=`
- KR source, wave mode design, shop currency, timer length, scoring, characters 2-5, game name
