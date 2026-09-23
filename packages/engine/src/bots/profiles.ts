import type { BotDifficulty } from '../types.js';

/**
 * Behavioural parameters per bot tier.
 *
 * Everything a bot does is derived from these numbers plus a seeded RNG, so a
 * given (seed, difficulty) pair always produces the same game. That property is
 * what makes bot behaviour testable at all: "medium bots must not win more than
 * X% against easy bots" is a deterministic assertion, not a flaky one.
 */
export interface BotProfile {
  /**
   * Fraction of the word table, ranked by commonness proxy, that the bot knows.
   * 1 means the whole dictionary.
   */
  readonly vocabularyFraction: number;
  /** Inclusive think-time band in milliseconds before submitting. */
  readonly minThinkMs: number;
  readonly maxThinkMs: number;
  /**
   * Probability the bot fails to find a word at all on a given turn even when
   * one exists — the main difficulty dial. Models "blanking".
   */
  readonly missChance: number;
  /**
   * Probability of submitting a wrong word first (costing time but not a life).
   * Makes lower tiers feel human rather than merely slow.
   */
  readonly fumbleChance: number;
  /**
   * How strongly the bot prefers short words. 0 picks uniformly among known
   * candidates; 1 almost always takes the shortest available.
   */
  readonly shortWordBias: number;
  /**
   * Cap on candidates examined per turn. Bounds worst-case turn cost so a
   * table of bots cannot stall the host on a very common syllable.
   */
  readonly searchLimit: number;
}

/**
 * Every knob is monotonic across the four tiers — vocabulary and search limit
 * rise, think time, miss chance, fumble chance and short-word bias fall. That
 * ordering is asserted in `bots.test.ts`, which is what stops a future tweak
 * from accidentally making `medium` stronger than `hard`.
 *
 * `missChance` is the dominant dial, and measurably so: each tier's answer
 * rate tracks (1 - missChance) almost exactly, because even three percent of a
 * 128k-word dictionary still turns up a candidate for nearly any syllable.
 * Vocabulary therefore shapes *which* word a bot plays — shorter, commoner,
 * less surprising — far more than whether it finds one at all. Reach for
 * `missChance` to change how often a tier survives; reach for
 * `vocabularyFraction` and `shortWordBias` to change how it reads.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = {
  easy: {
    vocabularyFraction: 0.035,
    minThinkMs: 2_800,
    maxThinkMs: 6_200,
    missChance: 0.32,
    fumbleChance: 0.26,
    shortWordBias: 0.9,
    searchLimit: 300,
  },
  medium: {
    vocabularyFraction: 0.25,
    minThinkMs: 1_500,
    maxThinkMs: 3_600,
    missChance: 0.11,
    fumbleChance: 0.12,
    shortWordBias: 0.6,
    searchLimit: 1_600,
  },
  hard: {
    vocabularyFraction: 0.75,
    minThinkMs: 500,
    maxThinkMs: 1_500,
    missChance: 0.015,
    fumbleChance: 0.03,
    shortWordBias: 0.2,
    searchLimit: 8_000,
  },
  // Unchanged by deliberate instruction: this tier is the reference point the
  // other three are tuned against.
  impossible: {
    vocabularyFraction: 1,
    minThinkMs: 0,
    maxThinkMs: 10,
    missChance: 0,
    fumbleChance: 0,
    shortWordBias: 0,
    searchLimit: Number.POSITIVE_INFINITY,
  },
};
