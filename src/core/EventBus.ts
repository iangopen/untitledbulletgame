import type { Wall } from './Box';
import type { DamageType } from './Soul';

/**
 * Every game event and its payload. Characters talk only through these;
 * they never import each other. Add new events here.
 */
export interface GameEvents {
  /**
   * A character's attack started: its first projectile spawned (or, for attacks with no
   * projectiles, the attack ran). Emitted by the Character base for every character.
   */
  attackStarted: { owner: string; attack: string };
  /** A character fired a beam (gen 0 = original, 1 = refracted child). */
  beamFired: { owner: string; x: number; y: number; angle: number; gen: number };
  /** A beam passed through a refraction prism and fanned out. */
  beamRefracted: { owner: string; x: number; y: number; count: number };
  /**
   * Prism's phase changed. `phase` is what runs now ('breather' = no new arrivals); `next` is the
   * phase that follows (for a breather) or the current one.
   */
  prismPhaseChanged: { owner: string; phase: 'rest' | 'ray' | 'breather'; next: 'rest' | 'ray' };
  /** Rose: one phase per unlocked attack. */
  rosePhaseChanged: { owner: string; phase: 'volley' | 'vine' | 'bloom' | 'breather'; next: 'volley' | 'vine' | 'bloom' };
  /** Mortimer's phase changed (one phase per unlocked attack; 'breather' = no new arrivals). */
  mortimerPhaseChanged: { owner: string; phase: 'snowfall' | 'roll' | 'blizzard' | 'breather'; next: 'snowfall' | 'roll' | 'blizzard' };
  /** A resize was requested (target size after the min-size clamp). anchor = fixed wall or 'center'. */
  boxResized: { width: number; height: number; duration: number; anchor: string };
  /** A move was requested (world-space target center). */
  boxMoved: { x: number; y: number; duration: number };
  /** A rotation was requested (absolute target, radians). */
  boxRotated: { rotation: number; duration: number };
  /** A toss scale was requested (target scale, 1 = on the ground). */
  boxScaled: { scale: number; duration: number };
  /** A tossed box landed back at full size (renderers shake on it). */
  boxLanded: { x: number; y: number };
  /** The soul's box was ripped into two halves side by side (`soulBox` = the half the soul is in). */
  boxSplit: { soulBox: 'left' | 'right'; gapAxis: 'x'; width: number; height: number };
  /** Two boxes merged back into one (its world center and size). */
  boxMerged: { x: number; y: number; width: number; height: number };
  /** A wall became safe or damaging. */
  wallStateChanged: { wall: Wall; damaging: boolean; damage: number; type: DamageType };
  /** A damaging wall touched the soul and the damage applied (not blocked by i-frames). */
  wallHit: { wall: Wall; damage: number; type: DamageType };
  /** One World step finished moving bullets (before hits). Combo rules use it for per-step checks. */
  stepped: { dt: number };
  /**
   * A combo rule (director/interactions.ts) fired: where, how many projectiles it affected or made,
   * and for a timing combo the world time it set (`at`).
   */
  comboTriggered: { id: string; x: number; y: number; count: number; at?: number };
  /** Ulysses' phase changed (one phase per unlocked attack; 'breather' = no new arrivals). */
  ulyssesPhaseChanged: { owner: string; phase: 'summon' | 'axe' | 'rain' | 'breather'; next: 'summon' | 'axe' | 'rain' };
  /** The Warden's phase changed (one phase per unlocked attack; 'breather' = nothing new). */
  wardenPhaseChanged: { owner: string; phase: 'punch' | 'toss' | 'rip' | 'breather'; next: 'punch' | 'toss' | 'rip' };
  /** Ember's phase changed (one phase per unlocked attack; 'breather' = no new arrivals). */
  emberPhaseChanged: { owner: string; phase: 'embers' | 'sweep' | 'wildfire' | 'breather'; next: 'embers' | 'sweep' | 'wildfire' };
  /** The equipped active ability was used (Shift). */
  abilityUsed: { id: string };
  /** Shift was pressed while the active ability was still recharging (nothing happened). */
  abilityDenied: { id: string; remaining: number };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

/** Small typed synchronous event bus. One per World. */
export class EventBus {
  private readonly handlers: { [K in EventName]?: Handler<K>[] } = {};

  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const list = (this.handlers[name] ??= []) as Handler<K>[];
    list.push(fn);
    return () => this.off(name, fn);
  }

  off<K extends EventName>(name: K, fn: Handler<K>): void {
    const list = this.handlers[name] as Handler<K>[] | undefined;
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends EventName>(name: K, payload: GameEvents[K]): void {
    const list = this.handlers[name] as Handler<K>[] | undefined;
    if (!list) return;
    for (const fn of list.slice()) fn(payload);
  }

  clear(): void {
    for (const k of Object.keys(this.handlers) as EventName[]) delete this.handlers[k];
  }
}
