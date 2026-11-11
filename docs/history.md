# History

## 2026-11-11 — Phase 1 "Feel"
Scaffolded Vite/TS/Phaser; Clock, Box, Soul, Collision with tests; temp spawner; HP/KR HUD.
Found during browser check: Phaser's smoothed `delta` slowed the sim under low frame rates; switched to `performance.now()` deltas.
Browser automation window throttles rAF, so verification drove `game.loop.step` manually with a fake clock.
