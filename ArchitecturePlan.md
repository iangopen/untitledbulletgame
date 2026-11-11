# Bullet-Hell Game — Architecture

Nov 11, 2026 · @Ian

## Overview

A keyboard-only bullet-hell where you dodge as a soul inside a box, Undertale-style, while a UCN-style roster of characters attacks at once at levels you choose (0–20). Personal hobby project, built over months including winter break.

**Locked decisions**

- Two time-based modes: a fixed survival timer, and a set sequence of waves
- All active characters attack simultaneously; pairs can interact or trigger combo attacks
- Characters can reshape the box (size, position, rotation, walls), depending on the character
- Levels change damage, attack frequency, and which attacks are used
- Some characters have non-bullet mechanics (darkness, poison zones, control effects)
- HP bar with i-frames; KR-style poison as a damage type; no one-hit mode for now
- No healing pickups for now
- Shop: equip one passive and one active ability; unlocks are abilities and cosmetics (soul colors), not characters
- 5 characters at launch, designed together one at a time; Prism is the first
- Geometric/minimal art style; no music for now; keyboard only
- Scoring is decided later

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Strongest language; types keep character configs honest |
| Engine | Phaser 3 | Game loop, input, rendering, tweens, scenes |
| Build | Vite | Fast dev server; static build output |
| Physics | None (hand-written collision) | Shape-vs-soul math is simpler and more predictable than Arcade physics |
| Data | TS config objects per character/ability | Tuning a level means editing data, not code |
| Save | localStorage | Unlocks, currency, loadout; no backend needed |
| Deploy | Static host (Vercel or GitHub Pages) | Playable by link |
| Tests | Vitest for pure logic (collision, config, damage) | Rendering verified in the browser |

## Folder structure

```
src/
  main.ts                 # Phaser game config, scene list
  scenes/
    MenuScene.ts          # mode select
    RosterScene.ts        # level toggles 0-20 per character
    ShopScene.ts          # equip one passive + one active
    BattleScene.ts        # the fight
    ResultsScene.ts
  core/
    Soul.ts               # movement, HP, i-frames, KR poison
    Box.ts                # arena: size, position, rotation, walls
    Clock.ts              # battle time, pause, time-scale hooks
    EventBus.ts           # typed events between systems
  combat/
    Bullet.ts             # base hazard: shape, damage, update, lifetime
    BulletPool.ts         # object reuse, no GC spikes
    Collision.ts          # shape-vs-soul tests (pure functions)
    patterns/             # line, fan, ring, aimed spawners
  characters/
    Character.ts          # base: level, schedule, attacks
    registry.ts           # all characters by id
    prism/
      Prism.ts
      prism.config.ts     # level -> attacks, damage, frequency
  director/
    Director.ts           # ticks active characters, ends battle
    interactions.ts       # combo rules between characters
    modes/
      TimerMode.ts
      WaveMode.ts
  abilities/
    passives/
    actives/
  data/
    save.ts               # localStorage wrapper
  render/
    theme.ts              # palette, character colors, glow
```

## Core principles

1. **Characters never reference each other.** They emit and listen to typed events on the EventBus (`beamHitWall`, `boxRotated`). Combos live only in `interactions.ts`, so adding a character never edits existing ones.
2. **The Box is the coordinate frame.** Bullets live in box-local space. When a character moves, resizes, or rotates the box, everything inside transforms with it for free.
3. **Characters are data plus a small class.** The config says what happens at each level; the class only covers behavior data can't express. Level 0 means inactive.
4. **The Director owns time.** It ticks every active character's schedule. Modes only decide when the battle ends (timer) or what loads next (waves).
5. **One damage entry point.** Everything calls `soul.damage({ amount, type })`; i-frames and KR are handled there and nowhere else.
6. **Fixed timestep simulation.** Game logic runs at a fixed 60 Hz step, separate from rendering, so difficulty doesn't change with frame rate.
7. **Pure logic is testable.** Collision, config lookup, damage, and scheduling are plain functions with unit tests; Phaser only draws.

## Systems

**Soul.** Arrow/WASD movement, a hold key for slow precise movement. The hitbox is smaller than the drawn soul. Holds HP, an i-frame timer after a normal hit, and a KR pool that drains HP over time and ticks through i-frames. Clamped to the box's inner bounds.

**Box.** Holds width, height, center, rotation, and per-wall state (safe or damaging). Exposes `toLocal` / `toWorld` and tweened changes (`resizeTo`, `moveTo`, `rotateTo`). Emits events when it changes so characters can react.

**Bullets.** One pooled `Bullet` class with a shape (circle, rect, triangle, beam), velocity, damage, damage type, lifetime, and an optional per-frame behavior hook. Patterns are spawner functions that place bullets; characters compose patterns rather than writing loops.

**Characters.** Each has an id, a color, a config keyed by level band, and an attack schedule. Each tick, the Director asks a character whether an attack is due, and the character spawns it. Higher bands unlock new attacks rather than only scaling numbers.

**Director.** Owns the active roster for a battle, ticks schedules, routes events, applies interaction rules, and reports win/lose. Caps simultaneous big attacks so max-level rosters stay hard but fair.

**Modes.** TimerMode ends when the clock hits the target. WaveMode reads a scripted list: each wave = characters, levels, duration.

**Abilities.** Passives modify Soul or Director values at battle start (e.g. longer i-frames). Actives are on a key with a cooldown (e.g. dash, short time-slow). One of each equipped.

**Save.** Versioned JSON in localStorage: currency, unlocked abilities and cosmetics, equipped loadout, last roster. Unknown versions reset safely.

## Character 1: Prism

A cyan triangle that splits light. The pure-dodging baseline: no box effect, no special mechanic.

| Levels | Attacks |
| --- | --- |
| 1–5 | Single-direction volleys of small triangles from the box edges, slow, obvious gaps |
| 6–14 | Beams split in two when they hit a box wall, so bounces must be tracked |
| 15–20 | Refraction: a large prism appears in the box; any beam passing through fans into three |

Within a band, level raises damage, speed, and frequency. Exact numbers get tuned in play.

Events it emits: `beamFired`, `beamHitWall`. Planned combos: Warden-style box rotation carries its beams; a wall slam could spawn a beam fan. Other characters are designed together later.

## Build order

Each phase ends playable and verified in the browser before the next starts.

1. **Feel.** Vite + Phaser scaffold, fixed-timestep loop, soul movement in a static box, one test bullet, collision, HP + i-frames, hit flash. Don't move on until dodging feels good.
2. **Bullet system.** Pool, shape types, box-local coordinates, line/fan/ring/aimed patterns, a debug scene to spawn each.
3. **Prism end to end.** Character base class, config format, registry, all three Prism bands.
4. **Director + Timer mode.** Roster scene with level toggles, battle start/end, results screen. First complete loop.
5. **Dynamic box.** Tweened resize/move/rotate, damaging walls, change events. Needed before box-shaping characters.
6. **Characters 2–5 + interactions.** One at a time, each tested alone and at max with the others.
7. **Wave mode.** Scripted wave format and a first wave set.
8. **Shop, abilities, save.** Currency from runs, first passives and actives, cosmetics, persistence.
9. **Polish.** Juice (shake, particles, glow), menus, balancing, scoring.

## Open questions

- [ ] Is KR poison only from certain characters, or a general option?
- [ ] Wave mode: hand-designed waves, or generated from the chosen roster?
- [ ] Shop currency: earned per run, or unlocks tied to beating setups?
- [ ] Timer mode length (starting guess: 2–3 minutes)
- [ ] Max HP, soul speed, hitbox size (tune in Phase 1)
- [ ] Scoring system
- [ ] Characters 2–5
- [ ] Game name
