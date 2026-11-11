/**
 * Character config format. Tuning a character means editing data, not code.
 *
 * A config is a list of level bands. Each band names the attacks enabled in it
 * and gives every numeric parameter as a [atBandStart, atBandEnd] range.
 * Within a band, values interpolate linearly by level. A band with from === to
 * uses the start value. Higher bands must list every attack of lower bands
 * (validateConfig checks this), so "higher bands keep lower attacks" is explicit data.
 */
export type Range = readonly [number, number];

/** Parameter ranges for one attack in one band. Keys are attack-specific. */
export type AttackRanges = Readonly<Record<string, Range>>;

export interface LevelBand<A extends string> {
  from: number;
  to: number;
  attacks: Readonly<Partial<Record<A, AttackRanges>>>;
}

export interface CharacterConfig<A extends string, R = Record<string, number | boolean>> {
  id: string;
  maxLevel: number;
  bands: readonly LevelBand<A>[];
  /** Non-level rules (e.g. split generation limit). Plain values Ian can tweak. */
  rules: R;
}

export type ResolvedAttack = Readonly<Record<string, number>>;

export interface ResolvedLevel<A extends string> {
  level: number;
  /** Index into config.bands, or -1 when inactive. */
  band: number;
  attacks: Partial<Record<A, ResolvedAttack>>;
}

/** Parameter names that resolve to whole numbers. */
export const INTEGER_PARAMS: ReadonlySet<string> = new Set(['count', 'gapSize']);

/** Exact parameter values for a level. Level 0 (or below) means inactive: no attacks. */
export function resolveLevel<A extends string>(cfg: CharacterConfig<A, unknown>, level: number): ResolvedLevel<A> {
  const lv = Math.max(0, Math.min(cfg.maxLevel, Math.floor(level)));
  const band = cfg.bands.findIndex((b) => lv >= b.from && lv <= b.to);
  const out: ResolvedLevel<A> = { level: lv, band, attacks: {} };
  if (lv === 0 || band < 0) return { level: lv, band: -1, attacks: {} };
  const b = cfg.bands[band]!;
  const t = b.to === b.from ? 0 : (lv - b.from) / (b.to - b.from);
  for (const id of Object.keys(b.attacks) as A[]) {
    const ranges = b.attacks[id]!;
    const vals: Record<string, number> = {};
    for (const [k, [lo, hi]] of Object.entries(ranges)) {
      const v = lo + (hi - lo) * t;
      vals[k] = INTEGER_PARAMS.has(k) ? Math.round(v) : v;
    }
    out.attacks[id] = vals;
  }
  return out;
}

/** Returns a list of problems (empty = valid). Tested for every shipped config. */
export function validateConfig<A extends string>(cfg: CharacterConfig<A, unknown>): string[] {
  const errs: string[] = [];
  let expect = 1;
  cfg.bands.forEach((b, i) => {
    if (b.from !== expect) errs.push(`band ${i} starts at ${b.from}, expected ${expect}`);
    if (b.to < b.from) errs.push(`band ${i} ends before it starts`);
    expect = b.to + 1;
    if (i > 0) {
      for (const id of Object.keys(cfg.bands[i - 1]!.attacks)) {
        if (!(id in b.attacks)) errs.push(`band ${i} drops attack "${id}" from band ${i - 1}`);
      }
    }
    for (const [id, ranges] of Object.entries(b.attacks as Record<string, AttackRanges>)) {
      if (!ranges.cooldown) errs.push(`band ${i} attack "${id}" has no cooldown`);
      else if (ranges.cooldown[0] <= 0 || ranges.cooldown[1] <= 0) errs.push(`band ${i} attack "${id}" cooldown must be > 0`);
    }
  });
  if (expect - 1 !== cfg.maxLevel) errs.push(`bands end at ${expect - 1}, maxLevel is ${cfg.maxLevel}`);
  return errs;
}
