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
  render/      theme
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
### Real (built and verified): Phase 1 "Feel"
- Vite + TS strict + Phaser 3.90 scaffold; `npm run build` (tsc + vite) and `npm test` (36 Vitest tests) pass.
- `src/tuning.ts`: every feel constant in one file. Current values: SOUL_SPEED 170 px/s, SLOW_MULTIPLIER 0.45, HITBOX_RADIUS 3 px (drawn diamond is 16 px across), MAX_HP 100, IFRAME_DURATION 1.0 s (blink period 0.1 s), KR_DRAIN_RATE 8 HP/s, box 300x220 px. Canvas is 640x480, FIT-scaled.
- `core/Clock.ts`: fixed 60 Hz accumulator. Each frame is capped at 0.25 s to avoid a spiral of death. BattleScene feeds it `performance.now()` deltas, NOT Phaser's `delta`, because Phaser smooths and caps that, which slowed the simulation when the frame rate dropped. Verified: identical movement at 30, 60 and 144 fps.
- `core/Box.ts`: centered static box; `toWorld`/`toLocal`/`clampLocal` already handle rotation (tested round-trip).
- `core/Soul.ts`: pure logic, box-local position, 8-direction movement (diagonals normalized), Shift slow mode, clamped to the interior by the hitbox radius. `damage({amount,type})` is the only damage path. Normal hit: immediate HP loss plus i-frames. KR hit: adds to the pool and grants i-frames; the pool drains continuously (including during i-frames) and never takes HP below 1. The KR pool is capped at hp-1.
- `combat/Collision.ts`: circle vs circle/rect (rotated)/triangle, pure and tested.
- BattleScene: geometric render (black box with white border, red diamond soul that blinks in i-frames, hitbox dot visible while slow, bullets masked to the box), HP bar with the KR portion in magenta and "KR" text. Dev-only `window.__battle` handle.
- TEMPORARY spawner in BattleScene (clearly marked): side lines with a gap, aimed shots, and a sweeping KR bar. Delete it in Phase 2.
- Browser-verified on the dev server: 8-direction movement, slow mode, edge clamping, single hit plus i-frame blocking, KR drain, and no console errors.

### Open
- Tuning values above are first guesses; tune by feel
- Whether KR hits should grant i-frames (currently yes) and whether KR can kill (currently no)
- Phase 2: Bullet, BulletPool, patterns, debug spawn scene (replaces the temp spawner)
- Bundle is about 1.5 MB (Phaser); chunk warning suppressed, revisit at deploy
- KR source: specific characters only, or general?
- Wave mode: hand-designed or generated?
- Shop currency source
- Timer length (guess 2–3 min)
- Scoring
- Characters 2–5
- Game name
