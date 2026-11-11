import type { DamageType } from '../core/Soul';

/**
 * Projectile types (the Undertale set). Every bullet has exactly one; its color comes only from
 * its type (theme.bullet), so the rule is readable at a glance for every character.
 *  - white:  hurts on contact
 *  - blue:   hurts only while the soul is moving
 *  - orange: hurts only while the soul is standing still
 *  - kr:     hurts on contact and deals KR (magenta)
 */
export type ProjectileType = 'white' | 'blue' | 'orange' | 'kr';
export const PROJECTILE_TYPES: readonly ProjectileType[] = ['white', 'blue', 'orange', 'kr'];

/**
 * The single place that decides whether touching a projectile hurts. `soulMoving` is the soul's
 * movement state from the current step (Soul.moving: it moved under player input this step).
 * A projectile that doesn't hurt passes through harmlessly: no damage, no i-frames.
 */
export function projectileHurts(kind: ProjectileType, soulMoving: boolean): boolean {
  if (kind === 'blue') return soulMoving;
  if (kind === 'orange') return !soulMoving;
  return true;
}

/** What Soul.damage receives for a projectile of this type. */
export function damageTypeOf(kind: ProjectileType): DamageType {
  return kind === 'kr' ? 'kr' : 'normal';
}
