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
1. Characters never import or reference each other. They communicate only through typed events on `core/EventBus.ts` (one bus per World, `world.bus`). Every event and its payload is declared in `GameEvents` there; add new events to that interface, never use untyped strings. Handlers run synchronously on emit. Combos live only in `director/interactions.ts`, so adding a character never edits existing ones.
2. The Box is the coordinate frame. Bullets store box-local positions; `Box.toWorld` / `toLocal` convert. Moving, resizing or rotating the box transforms everything inside it.
3. Characters are config plus a small class. `<name>.config.ts` maps level bands to attacks, damage, speed, frequency. The class only holds behavior the config can't express. Level 0 = inactive.
   Config format (`characters/config.ts`):
   - `bands: [{ from, to, attacks: { <attackId>: { <param>: [atBandStart, atBandEnd] } } }]`, covering 1..maxLevel with no gaps.
   - `resolveLevel(cfg, level)` interpolates every param linearly within the level's band. `count` and `gapSize` round to integers. A one-level band uses its start value.
   - Every attack needs a `cooldown` (seconds between shots). Higher bands must re-list every lower attack (enforced by `validateConfig`, tested for every shipped config), so "keeps lower attacks" is explicit data. Difficulty must not drop at band edges (also tested).
   - `rules`: non-level constants (limits, sizes, design defaults).
   - `Character` (base) resolves on `setLevel`, runs one timer per enabled attack on the fixed step, and calls the subclass's one-method-per-attack map. It owns a seeded RNG so sequences are reproducible. `registry.ts` lists characters by id; the runner and Director use only `CharacterHandle`.
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
Live: https://iangopen.github.io/untitledbulletgame/ (pass `?prism=<0-20>` to set Prism's level). Deployed by `.github/workflows/deploy.yml` on every push to main: npm ci, npm test, npm run build, then Pages. Actions are pinned to Node-24 versions (checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5).

### Real (built and verified)
**Phase 1 (Feel):** fixed 60 Hz Clock fed by `performance.now()`; Box with rotation-ready `toWorld`/`toLocal`; Soul with 8-way and slow movement, HP, i-frames, and KR (drains 8 HP/s through i-frames, KR hits respect and grant i-frames, can't drop HP below 1; unchanged).

**Phase 2 (Bullets):** Bullet (circle/rect/triangle/beam; hooks; `gen`/`flags`/`color` fields), BulletPool (1024, graceful overflow), patterns line/fan/ring/aimed, exact hitboxes from shared geometry, JSAB-style BattleView with spawn pop, despawn ghosts, hit flash and shake, dev hitbox overlay (H), dev DebugScene (backtick).

**Phase 3 (Characters + Prism):**
- `core/EventBus.ts` (typed), `characters/config.ts` (resolver and validator), `Character.ts`, `registry.ts`, and Prism at levels 0-20 as described above. World now has `bus` and `props` (non-damaging, drawn translucent).
- TEMPORARY runner in BattleScene (stands in for the Director): creates every registered character. Levels come from the URL `?<id>=n`, defaulting to prism 1; dev keys `[` / `]` step the level down and up; the level is shown top-left; R restarts at the same levels.
- Tests: 88 Vitest cases, including the resolver at band edges and midpoints, config validation, Prism band membership, difficulty never dropping across levels, split-once, refraction into exactly 3, level 0 spawning nothing, and level 20 bounded over 60 s.
- Browser-verified (30 s per level, soul invincible): L0 nothing; L1 volleys every 2.5 s; L5 every 1.9 s; L6 volleys every 1.8 s plus beams every 3.0 s; L10 volleys 1.5 s plus beam pairs 2.7 s; L14 volleys 1.3 s plus beam pairs 1.8 s; L15 adds the prism (4 relocations, 24 refractions); L20 volleys 1.0 s, beam triples 1.4 s, 48 refractions, peak 45 bullets. Traced: a beam split at a wall; its children left through walls with split=false; a prism refraction produced exactly 3 beams that exited without splitting.
- Perf at level 20 (overlay off, 4 runs of 35-40 s): peak 42-46 bullets, median frame 0.2 ms, sim step at most 2 ms. 0-2 frames per run went over 16.7 ms (worst 36.9 ms), at random moments, in Phaser render or draw rather than the sim, which looks like GC or browser pauses.

### Open
- Rare render-side frame spikes (see above): profile in a normal (non-automated) browser before adding more characters.
- Graphics redraws every path each frame (~13 ms/frame at 900 bullets in the Phase 2 stress test); fine at Prism's ~45.
- Prism numbers are first guesses; tune by feel. Open design calls: prism harmless?, refracted beams split?, prism relocation rate.
- KR rules (i-frames on KR hits, non-lethal), Ian deciding; Prism deals no KR.
- Director, roster UI and modes (Phase 4) replace the temporary runner
- KR source, wave mode design, shop currency, timer length, scoring, characters 2-5, game name
