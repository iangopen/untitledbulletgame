# History

## 2026-11-11 — Phase 1 "Feel"
Scaffolded Vite/TS/Phaser; Clock, Box, Soul, Collision with tests; temp spawner; HP/KR HUD.
Found during browser check: Phaser's smoothed `delta` slowed the sim under low frame rates; switched to `performance.now()` deltas.
Browser automation window throttles rAF, so verification drove `game.loop.step` manually with a fake clock.

## 2026-11-11 — Phase 2 "Bullet system"
Bullet/BulletPool/patterns, World + BattleView split, JSAB-style restyle, exact hitboxes, dev hitbox overlay, DebugScene, Pages deploy workflow.
Bug fixed during tests: the wall hook missed bullets in their first step (stored inside flag); now computed from pre-move position.
DebugScene initially leaked into the prod bundle via a static import; now a DEV-only dynamic import.
