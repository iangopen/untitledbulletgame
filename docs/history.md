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
