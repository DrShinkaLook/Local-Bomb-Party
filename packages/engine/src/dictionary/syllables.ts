import type { Rng } from '../util/rng.js';
import type { SyllableDifficulty } from '../types.js';
import type { Dictionary } from './dictionary.js';
import { MAX_N, MIN_N } from './ngramIndex.js';

/**
 * Weighted syllable generation.
 *
 * The pools are *derived from the loaded dictionary*, not hand-copied from
 * anywhere. Every indexed 2- and 3-gram is scored by how many words contain it,
 * and the distribution is cut into difficulty tiers. Two consequences:
 *
 *   - Swapping in a mod word list automatically reshapes the pools. A syllable
 *     that is common in English but absent from a themed word list stops being
 *     offered, with no configuration.
 *   - Impossible prompts cannot be generated. A gram only enters a pool if at
 *     least `minWords` words contain it, and the live availability counter is
 *     rechecked at draw time, so a syllable cannot be handed out after the
 *     round has consumed the last word that satisfies it.
 *
 * Tier boundaries are expressed as quantiles of the *feasible* gram
 * distribution rather than absolute counts, so they hold for a 5k-word mod list
 * and a 300k-word dictionary alike.
 */

export interface SyllablePools {
  readonly common: readonly string[];
  readonly uncommon: readonly string[];
  readonly rare: readonly string[];
}

export interface SyllableGeneratorOptions {
  /** A gram must appear in at least this many words to ever be offered. */
  readonly minWords?: number;
  /** Fraction of feasible grams that count as "common" (highest coverage). */
  readonly commonQuantile?: number;
  /** Fraction that count as "uncommon"; the remainder are "rare". */
  readonly uncommonQuantile?: number;
  /** Restrict generated syllable lengths. Defaults to 2-3. */
  readonly minLength?: number;
  readonly maxLength?: number;
  /**
   * Bias within a tier. 0 = uniform; 1 = proportional to word coverage.
   * A little bias makes common tiers feel natural without making them
   * repetitive.
   */
  readonly coverageBias?: number;
  /** Extra syllables from a mod pack. Still feasibility-checked. */
  readonly extraSyllables?: Partial<Record<SyllableDifficulty, readonly string[]>>;
  /** How many recent syllables to avoid repeating. */
  readonly historySize?: number;
  /**
   * A vowelless gram is only admitted if at least this many words *begin* with
   * it. See `isWellFormed` for why.
   */
  readonly minOnsetWords?: number;
}

interface Scored {
  readonly gram: string;
  readonly coverage: number;
}

const DEFAULTS = {
  minWords: 60,
  commonQuantile: 0.25,
  uncommonQuantile: 0.65,
  minLength: MIN_N,
  maxLength: MAX_N,
  coverageBias: 0.35,
  historySize: 8,
  minOnsetWords: 40,
} as const;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

export class SyllableGenerator {
  private readonly dict: Dictionary;
  private readonly opts: Required<Omit<SyllableGeneratorOptions, 'extraSyllables'>>;
  private readonly pools: Record<SyllableDifficulty, Scored[]>;
  private readonly history: string[] = [];

  constructor(dict: Dictionary, options: SyllableGeneratorOptions = {}) {
    this.dict = dict;
    this.opts = {
      minWords: options.minWords ?? DEFAULTS.minWords,
      commonQuantile: options.commonQuantile ?? DEFAULTS.commonQuantile,
      uncommonQuantile: options.uncommonQuantile ?? DEFAULTS.uncommonQuantile,
      minLength: options.minLength ?? DEFAULTS.minLength,
      maxLength: options.maxLength ?? DEFAULTS.maxLength,
      coverageBias: options.coverageBias ?? DEFAULTS.coverageBias,
      historySize: options.historySize ?? DEFAULTS.historySize,
      minOnsetWords: options.minOnsetWords ?? DEFAULTS.minOnsetWords,
    };
    this.pools = this.buildPools(options.extraSyllables);
  }

  private buildPools(
    extra?: Partial<Record<SyllableDifficulty, readonly string[]>>,
  ): Record<SyllableDifficulty, Scored[]> {
    const { grams, onsets } = this.surveyGrams();
    const feasible: Scored[] = [];

    for (const gram of grams) {
      const coverage = this.dict.countTotal(gram);
      if (coverage < this.opts.minWords) continue;
      if (!this.isWellFormed(gram, onsets.get(gram) ?? 0)) continue;
      feasible.push({ gram, coverage });
    }

    // Descending coverage: the head of the list is what players will find easy.
    feasible.sort((a, b) => b.coverage - a.coverage || a.gram.localeCompare(b.gram));

    const commonEnd = Math.max(1, Math.floor(feasible.length * this.opts.commonQuantile));
    const uncommonEnd = Math.max(
      commonEnd + 1,
      Math.floor(feasible.length * this.opts.uncommonQuantile),
    );

    const pools: Record<SyllableDifficulty, Scored[]> = {
      common: feasible.slice(0, commonEnd),
      uncommon: feasible.slice(commonEnd, uncommonEnd),
      rare: feasible.slice(uncommonEnd),
    };

    // Mod-supplied syllables are appended to their declared tier, but only if
    // the current dictionary can actually satisfy them.
    if (extra) {
      for (const tier of ['common', 'uncommon', 'rare'] as const) {
        for (const raw of extra[tier] ?? []) {
          const gram = raw.trim().toLowerCase();
          const coverage = this.dict.countTotal(gram);
          if (coverage >= this.opts.minWords) pools[tier].push({ gram, coverage });
        }
      }
    }

    // A degenerate word list can empty a tier; fold empties into the nearest
    // populated one so `getRandomSyllable` never has to fail.
    if (pools.rare.length === 0) pools.rare = pools.uncommon;
    if (pools.uncommon.length === 0) pools.uncommon = pools.common;
    return pools;
  }

  /**
   * Single pass over the word table collecting both the set of candidate grams
   * and, for each, how many words *begin* with it. One scan rather than one per
   * gram: coverage itself comes from the O(1) n-gram index.
   */
  private surveyGrams(): { grams: Set<string>; onsets: Map<string, number> } {
    const grams = new Set<string>();
    const onsets = new Map<string, number>();

    for (const word of this.dict.wordTable) {
      for (let length = this.opts.minLength; length <= this.opts.maxLength; length += 1) {
        if (word.length < length) continue;
        for (let i = 0; i + length <= word.length; i += 1) {
          grams.add(word.slice(i, i + length));
        }
        const onset = word.slice(0, length);
        onsets.set(onset, (onsets.get(onset) ?? 0) + 1);
      }
    }
    return { grams, onsets };
  }

  /**
   * Reject grams that are statistically common but read as noise on screen.
   *
   * Coverage alone is a bad admissibility test. "rp", "hs" and "bst" each occur
   * in thousands of words, but only ever straddle a syllable boundary
   * ("sharply", "months", "substance"); a player shown "RP" has to reverse-
   * engineer the split rather than think of a word. Grams that carry a vowel
   * read as pronounceable units, and vowelless grams that are genuine English
   * onsets ("st", "ch", "thr", "spl") are recognisable because words start with
   * them. Everything else is a scanning artefact.
   *
   * The onset threshold is measured against the loaded dictionary, so a themed
   * mod list gets its own answer rather than inheriting English's.
   */
  private isWellFormed(gram: string, onsetCount: number): boolean {
    for (const ch of gram) {
      if (VOWELS.has(ch)) return true;
    }
    return onsetCount >= this.opts.minOnsetWords;
  }

  /** Snapshot of the derived pools, for the dev overlay and tests. */
  poolSizes(): Record<SyllableDifficulty, number> {
    return {
      common: this.pools.common.length,
      uncommon: this.pools.uncommon.length,
      rare: this.pools.rare.length,
    };
  }

  peekPool(difficulty: SyllableDifficulty, limit = 20): string[] {
    return this.pools[difficulty].slice(0, limit).map((s) => s.gram);
  }

  /**
   * Draw a syllable of the requested difficulty.
   *
   * Rejection-samples against the *live* availability counter so a prompt is
   * never issued that the remaining word pool cannot satisfy, and against a
   * short history so the same syllable does not appear twice in a row.
   * Falls back progressively rather than throwing: an easier tier first, then
   * any feasible gram at all.
   */
  getRandomSyllable(difficulty: SyllableDifficulty, rng: Rng, minWords?: number): string {
    const floor = minWords ?? this.opts.minWords;
    const order: SyllableDifficulty[] =
      difficulty === 'rare'
        ? ['rare', 'uncommon', 'common']
        : difficulty === 'uncommon'
          ? ['uncommon', 'common', 'rare']
          : ['common', 'uncommon', 'rare'];

    for (const tier of order) {
      const picked = this.drawFrom(this.pools[tier], rng, floor, true);
      if (picked !== null) return this.remember(picked);
    }
    // Second sweep ignoring the repeat-history constraint.
    for (const tier of order) {
      const picked = this.drawFrom(this.pools[tier], rng, floor, false);
      if (picked !== null) return this.remember(picked);
    }
    // Last resort: relax the word floor to "at least one word remains".
    for (const tier of order) {
      const picked = this.drawFrom(this.pools[tier], rng, 1, false);
      if (picked !== null) return this.remember(picked);
    }
    throw new Error('no feasible syllable remains in the dictionary');
  }

  private drawFrom(
    pool: readonly Scored[],
    rng: Rng,
    floor: number,
    avoidHistory: boolean,
  ): string | null {
    if (pool.length === 0) return null;

    // Bounded rejection sampling. The pools are large and mostly feasible, so
    // this terminates in one or two draws in the overwhelming majority of
    // cases; the linear fallback below guarantees termination regardless.
    const attempts = Math.min(64, pool.length);
    for (let i = 0; i < attempts; i += 1) {
      const candidate = this.sampleBiased(pool, rng);
      if (avoidHistory && this.history.includes(candidate.gram)) continue;
      if (this.dict.countAvailable(candidate.gram) >= floor) return candidate.gram;
    }

    for (const candidate of pool) {
      if (avoidHistory && this.history.includes(candidate.gram)) continue;
      if (this.dict.countAvailable(candidate.gram) >= floor) return candidate.gram;
    }
    return null;
  }

  /** Uniform when bias is 0, coverage-proportional when bias is 1. */
  private sampleBiased(pool: readonly Scored[], rng: Rng): Scored {
    const bias = this.opts.coverageBias;
    if (bias <= 0) return rng.pick(pool);

    const a = pool[rng.int(pool.length)] as Scored;
    const b = pool[rng.int(pool.length)] as Scored;
    // Pick the higher-coverage of two draws with probability `bias`. This is a
    // cheap, allocation-free approximation of a coverage-weighted distribution
    // that avoids rebuilding a cumulative weight table every call.
    const preferHigher = rng.next() < bias;
    if (a.coverage === b.coverage) return a;
    const higher = a.coverage > b.coverage ? a : b;
    const lower = a.coverage > b.coverage ? b : a;
    return preferHigher ? higher : lower;
  }

  private remember(gram: string): string {
    this.history.push(gram);
    if (this.history.length > this.opts.historySize) this.history.shift();
    return gram;
  }

  resetHistory(): void {
    this.history.length = 0;
  }
}
