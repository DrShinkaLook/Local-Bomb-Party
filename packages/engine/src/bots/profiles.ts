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

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = {
  easy: {
    vocabularyFraction: 0.06,
    minThinkMs: 2_000,
    maxThinkMs: 5_000,
    missChance: 0.22,
    fumbleChance: 0.18,
    shortWordBias: 0.85,
    searchLimit: 400,
  },
  medium: {
    vocabularyFraction: 0.35,
    minThinkMs: 1_000,
    maxThinkMs: 3_000,
    missChance: 0.06,
    fumbleChance: 0.07,
    shortWordBias: 0.5,
    searchLimit: 2_000,
  },
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
