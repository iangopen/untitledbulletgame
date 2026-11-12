import type { World } from '../core/World';
import type { MoveInput } from '../core/Soul';
import type { CharacterHandle } from '../characters/Character';
import { registry, type CharacterEntry } from '../characters/registry';
import { installInteractions } from './interactions';
import type { BattleMode, BattleResult, BattleState } from './modes/Mode';
import { normalizeRoster, type Roster } from './roster';

export interface Outcome {
  result: BattleResult;
  mode: string;
  /** Seconds survived (battle time when it ended). */
  time: number;
  hp: number;
  maxHp: number;
  roster: Roster;
}

/**
 * Owns one battle: the active roster, battle time, character ticks, combo
 * interactions and the outcome. Pure (no Phaser); the scene feeds it input.
 */
export class Director {
  readonly roster: Roster;
  /** Only characters with level > 0 are created and ticked. */
  readonly characters: CharacterHandle[];
  time = 0;
  outcome: Outcome | null = null;
  private readonly disposeInteractions: () => void;

  constructor(
    readonly world: World,
    roster: Roster,
    readonly mode: BattleMode,
    entries: readonly CharacterEntry[] = registry,
  ) {
    this.roster = normalizeRoster(roster, entries);
    this.characters = entries
      .filter((e) => (this.roster[e.id] ?? 0) > 0)
      .map((e) => {
        const c = e.create(world);
        c.setLevel(this.roster[e.id]!);
        return c;
      });
    this.disposeInteractions = installInteractions(world, new Set(this.characters.map((c) => c.id)));
  }

  get state(): BattleState {
    return { time: this.time, soulAlive: this.world.soul.alive };
  }

  get over(): boolean {
    return this.outcome !== null;
  }

  /** One fixed step. No-op once the battle has an outcome. */
  step(input: MoveInput, dt: number): void {
    if (this.outcome) return;
    const w = this.world;
    // Character attack timers run on world time (Slow time scales them); the battle timer counts
    // REAL time, so slow time can't make a timer run end sooner or later.
    const wdt = dt * w.timeScale;
    for (const c of this.characters) c.tick(wdt);
    w.step(input, dt);
    this.time += dt;
    const result = this.mode.evaluate(this.state);
    if (result) {
      this.outcome = {
        result,
        mode: this.mode.id,
        time: this.time,
        hp: Math.max(0, w.soul.hp),
        maxHp: w.soul.maxHp,
        roster: { ...this.roster },
      };
    }
  }

  dispose(): void {
    this.disposeInteractions();
    for (const c of this.characters) c.dispose();
  }
}
