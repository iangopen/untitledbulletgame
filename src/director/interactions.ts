import type { EventBus } from '../core/EventBus';
import { propTriangle, type World } from '../core/World';
import { pointInTriangle, type Triangle } from '../combat/Collision';
import { fan } from '../combat/patterns';
import type { Bullet } from '../combat/Bullet';
import { SWORD_FLAGS } from '../characters/ulysses/ulysses.config';

/**
 * Cross-character combo rules live here and only here. Characters never know
 * about each other; a rule listens to bus events from some characters and
 * reacts (spawns, buffs, etc.). A rule is installed only when every character it requires is
 * active (level > 0), so a combo never runs for a character that isn't in the battle.
 */
export interface Interaction {
  id: string;
  /** Character ids that must all be active for this rule to run. */
  requires: readonly string[];
  /** Subscribe to the bus; return an unsubscribe function. */
  install(bus: EventBus, world: World): () => void;
}

/** Prism + Ulysses: fan of a sword through a refraction prism (radians, total). */
export const PRISM_SWORD_SPREAD = 0.6;
/** Mortimer + Ulysses: extra gold time added so a blizzard group shines together (s). */
export const BLIZZARD_HOLD = 0.6;

const isUlyssesSword = (b: Bullet): boolean => b.active && b.owner === 'ulysses' && (b.flags & SWORD_FLAGS.sword) !== 0;

/**
 * Prism + Ulysses: an active (white) sword whose center enters a refraction prism is replaced by
 * three white swords fanned around its heading; they carry the split flag and ignore prisms.
 */
export const prismSwordSplit: Interaction = {
  id: 'prism-ulysses-split',
  requires: ['prism', 'ulysses'],
  install(bus, world) {
    const tri: Triangle = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0 };
    return bus.on('stepped', () => {
      for (const prop of world.props) {
        if (!prop.refracts) continue;
        propTriangle(prop, tri);
        for (const b of world.pool.all) {
          if (!isUlyssesSword(b) || !b.armed || b.flags & SWORD_FLAGS.split) continue;
          if (!pointInTriangle(b.x, b.y, tri)) continue;
          const { x, y, vx, vy } = b;
          const style = {
            shape: b.shape, form: b.form ?? undefined, a: b.a, b: b.b, damage: b.damage, owner: b.owner, kind: b.kind,
            faceVelocity: true, noPop: true, flags: SWORD_FLAGS.sword | SWORD_FLAGS.split,
          };
          world.pool.release(b, 'cleared');
          const n = fan(world.pool, { x, y, angle: Math.atan2(vy, vx), count: 3, spread: PRISM_SWORD_SPREAD, speed: Math.hypot(vx, vy), style });
          bus.emit('comboTriggered', { id: 'prism-ulysses-split', x, y, count: n });
        }
      }
    });
  },
};

/**
 * Mortimer + Ulysses: while Mortimer is in his blizzard phase, every gold Ulysses projectile is
 * held gold until one shared moment (the latest planned shine among them + BLIZZARD_HOLD), so they
 * all shine together. A new projectile joining a group that hasn't shone yet pushes it later if it
 * needs to; once a group shines, the next gold projectile starts a new group.
 */
export const blizzardSync: Interaction = {
  id: 'mortimer-ulysses-blizzard-sync',
  requires: ['mortimer', 'ulysses'],
  install(bus, world) {
    let blizzard = false;
    /** World time of the group's shared shine, or -1 when no group is waiting. */
    let shineAt = -1;
    const held = new Set<Bullet>();
    const offPhase = bus.on('mortimerPhaseChanged', (e) => {
      blizzard = e.phase === 'blizzard';
    });
    const offStep = bus.on('stepped', () => {
      if (shineAt >= 0 && world.time >= shineAt - 1e-9) {
        shineAt = -1;
        held.clear();
      }
      if (!blizzard) return;
      let grew = false;
      for (const b of world.pool.all) {
        if (!b.active || b.owner !== 'ulysses' || b.armed || held.has(b)) continue;
        // Its own planned shine, plus the hold; the group shines at the latest of these.
        const own = world.time + (b.armAt - b.age) + BLIZZARD_HOLD;
        if (own > shineAt) {
          shineAt = own;
          grew = true;
        }
        held.add(b);
      }
      if (held.size === 0) return;
      for (const b of held) if (b.active && !b.armed) b.armAt = b.age + (shineAt - world.time);
      if (grew) bus.emit('comboTriggered', { id: 'mortimer-ulysses-blizzard-sync', x: 0, y: 0, count: held.size, at: shineAt });
    });
    return () => {
      offPhase();
      offStep();
    };
  },
};

export const interactions: readonly Interaction[] = [prismSwordSplit, blizzardSync];

/** Install every rule whose required characters are active. Returns one disposer for all. */
export function installInteractions(
  world: World,
  activeIds: ReadonlySet<string>,
  rules: readonly Interaction[] = interactions,
): () => void {
  const offs = rules.filter((r) => r.requires.every((id) => activeIds.has(id))).map((r) => r.install(world.bus, world));
  return () => offs.forEach((off) => off());
}
