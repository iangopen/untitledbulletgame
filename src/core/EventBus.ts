import type { Wall } from './Box';
import type { DamageType } from './Soul';

/**
 * Every game event and its payload. Characters talk only through these;
 * they never import each other. Add new events here.
 */
export interface GameEvents {
  /** A character fired a beam (gen 0 = original, 1 = split/refracted child). */
  beamFired: { owner: string; x: number; y: number; angle: number; gen: number };
  /** A beam's center crossed a box wall from inside. `split` says whether it split there. */
  beamHitWall: { owner: string; wall: Wall; x: number; y: number; gen: number; split: boolean };
  /** A beam passed through a refraction prism and fanned out. */
  beamRefracted: { owner: string; x: number; y: number; count: number };
  /** A resize was requested (target size after the min-size clamp). anchor = fixed wall or 'center'. */
  boxResized: { width: number; height: number; duration: number; anchor: string };
  /** A move was requested (world-space target center). */
  boxMoved: { x: number; y: number; duration: number };
  /** A rotation was requested (absolute target, radians). */
  boxRotated: { rotation: number; duration: number };
  /** A wall became safe or damaging. */
  wallStateChanged: { wall: Wall; damaging: boolean; damage: number; type: DamageType };
  /** A damaging wall touched the soul and the damage applied (not blocked by i-frames). */
  wallHit: { wall: Wall; damage: number; type: DamageType };
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
