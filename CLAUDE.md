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

## Commands
- `npm run dev`: dev server
- `npm run build`: production build (the gate)
- `npm test`: Vitest

## Architecture rules
1. Characters never import or reference each other. They communicate through typed events on `core/EventBus.ts`. Combos live only in `director/interactions.ts`, so adding a character never edits existing ones.
2. The Box is the coordinate frame. Bullets store box-local positions; `Box.toWorld` / `toLocal` convert. Moving, resizing or rotating the box transforms everything inside it.
3. Characters are config plus a small class. `<name>.config.ts` maps level bands to attacks, damage, speed, frequency. The class only holds behavior the config can't express. Level 0 = inactive.
4. The Director owns battle time and ticks every active character's schedule. Modes (`TimerMode`, `WaveMode`) only decide when the battle ends or what loads next.
5. All damage goes through `soul.damage({ amount, type })`. i-frames and KR poison are handled there and nowhere else.
6. Game logic runs on a fixed 60 Hz timestep, separate from rendering, so difficulty is frame-rate independent.
7. Collision, config lookup, damage, and scheduling are pure functions with unit tests. Phaser code only draws and reads input.
8. Bullets come from `BulletPool`; never `new Bullet()` inside the game loop.
9. Colors come from `render/theme.ts`. Each character owns one accent color; bullets must stay readable against the box at all levels.
10. Exact hitboxes: what you see is what hits you. Every collision shape equals its drawn shape and size. Drawing and collision both derive from the same geometry functions in `combat/Bullet.ts` (`bulletCircle`/`bulletRect`/`bulletTriangle`), and the soul's drawn radius is its hit radius. Never add a separate "hitbox size". The spawn pop scales both together; despawn fades are visual-only ghosts that never collide.
11. Visual style (in the spirit of Just Shapes & Beats): near-black background, flat bright solid shapes with crisp edges, no textures or images, thin clean box border. Motion is short and punchy: quick scale-pop on spawn, fast fade on despawn, brief flash and small shake when the soul is hit.
12. Red belongs to the player (solid red circle). Hazards never use red. Generic bullets are white; KR is magenta.
13. Characters customise bullets through `onStep`/`onWall` hooks and compose `combat/patterns/` (line, fan, ring, aimed), not through Bullet subclasses or hand-written spawn loops.

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
  render/      theme, BattleView
```

## Locked game decisions
- Two modes, both time-based: fixed survival timer, and a scripted set of waves
- HP bar with i-frames; KR-style poison as a damage type; no one-hit mode; no healing pickups
- Shop: one passive and one active ability equipped; unlocks are abilities and cosmetics, never characters
- 5 characters at launch; Prism is #1; the rest are designed with Ian, not invented by Claude
- Keyboard only; no music yet; scoring decided later

## Characters
### Prism (cyan triangle) — pure dodging, no box effect
- Levels 1–5: single-direction volleys from box edges, slow, clear gaps
- Levels 6–14: beams split in two on hitting a box wall
- Levels 15–20: refraction prism appears in the box; beams passing through fan into three
- Emits: `beamFired`, `beamHitWall`

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
Live: https://iangopen.github.io/untitledbulletgame/ (deployed by `.github/workflows/deploy.yml` on every push to main; the workflow runs `npm ci`, `npm test` and `npm run build`, and tests gate the deploy).

### Real (built and verified)
**Phase 1 (Feel)**
- Fixed 60 Hz `core/Clock.ts`. Scenes feed it `performance.now()` deltas, not Phaser's smoothed `delta`. Each frame is capped at 0.25 s.
- `core/Box.ts`: static centered box; `toWorld`/`toLocal`/`clampLocal` support rotation.
- `core/Soul.ts`: 8-direction movement with normalized diagonals, Shift slow mode, clamped to the box. `damage({amount,type})` is the only damage path. KR rules (unchanged in Phase 2): KR adds to a pool that drains 8 HP/s, including through i-frames. KR hits respect and grant i-frames. KR can't drop HP below 1.

**Phase 2 (Bullet system)**
- `combat/Bullet.ts`: one class with shapes circle, rect, triangle and beam. Size fields `a`/`b` (circle a=r; rect a/b = half extents; triangle a = circumradius; beam a = length, b = thickness). Box-local position and velocity, rotation, spin, faceVelocity, damage, type, lifetime, owner, and `onStep`/`onWall` hooks.
- `combat/BulletPool.ts`: 1024 preallocated bullets with a free-index stack. Spawning past capacity returns null, counts `dropped` and warns once in dev. `update()` runs the hook, motion, lifetime, wall crossings (inside → outside fires `onWall` with `pass`/`bounce`/`die`, and hooks can spawn through the context for splits) and despawns beyond `DESPAWN_MARGIN`.
- `combat/patterns/`: `line` (edge, gaps), `fan`, `ring`, `aimed`. Each takes a `style` (any BulletSpec fields) and returns the number spawned.
- `core/World.ts`: pure step for soul + pool + hits. Hits go `hitTest.bulletHitsCircle` → `Collision.ts` → `Soul.damage`, all in box-local space.
- `render/BattleView.ts`: draws box, bullets, spawn pop, despawn ghosts, the soul as a red circle, the HP/KR bar, hit flash and shake, and the dev hitbox overlay (H).
- BattleScene: a deterministic 10 s looping demo (`scenes/demo.ts`) replaced the temporary spawner.
- DebugScene (dev only; backtick from Battle; dynamically imported, so it's absent from the prod bundle): keys 1–8 fire the patterns, rotated rects, split beams (wall hook), KR and bouncing triangles; 0 is the stress test; C clears; I toggles invincible. Readout shows bullet count, drops, and average/max step ms.
- Tuning (`src/tuning.ts`): SOUL_RADIUS 6, SOUL_SPEED 170, SLOW_MULTIPLIER 0.45, MAX_HP 100, IFRAME_DURATION 1.0, KR_DRAIN_RATE 8, box 300x220, BULLET_CAPACITY 1024, DESPAWN_MARGIN 48, SPAWN_POP_TIME 0.08, DESPAWN_FADE_TIME 0.12, plus hit shake/flash values.
- Tests: 70 Vitest cases. They cover collision exact-contact, near-miss (+0.01 px) and graze (−0.01 px) for every shape pair, including rotated rects and triangles; pool, wall hooks, every pattern, and World hits.
- Browser-verified: hitbox outlines sit on drawn shapes, including rotated ones; near-miss and touch behave correctly in the live World; every pattern fires; bullets despawn off-box; i-frames block repeat hits. Sim step is 0.1–0.3 ms median at 300–900 bullets; a full frame (with the overlay on) is about 4.5 ms at 300 and 13 ms at 900.

### Open
- Render cost dominates at high bullet counts: Graphics rebuilds every path each frame (~13 ms/frame at 900 bullets). Consider batching or textures-from-shapes if characters need more than ~600 bullets.
- Despawn ghosts are visual-only (no collision) by design; revisit if that ever reads as unfair.
- Tuning values are first guesses; tune by feel
- KR rules (i-frames on KR hits, non-lethal) — Ian deciding
- KR source: specific characters only, or general?
- Wave mode: hand-designed or generated?
- Shop currency source
- Timer length (guess 2–3 min)
- Scoring
- Characters 2–5
- Game name
