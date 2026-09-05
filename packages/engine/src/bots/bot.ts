import type { BotDifficulty } from '../types.js';
import type { Dictionary } from '../dictionary/dictionary.js';
import type { Rng } from '../util/rng.js';
import { BOT_PROFILES, type BotProfile } from './profiles.js';

/**
 * Offline, deterministic bots.
 *
 * No network calls, no model inference, no timers of their own. A bot is asked
 * "what would you do with this syllable, right now?" and answers with a word
 * and a delay; the host schedules the submission on its own clock. That keeps
 * every bot decision inside the authoritative simulation and replayable from a
 * seed.
 *
 * Vocabulary tiering uses word length and dictionary rank as a commonness
 * proxy. A real frequency list would be better and is the obvious upgrade path
 * (`FrequencyTable` in the roadmap), but it needs a corpus with a compatible
 * licence; length ranking is a defensible approximation in the meantime and is
 * documented as such rather than passed off as frequency data.
 */

export interface BotDecision {
  /** The word to submit, or null when the bot fails to find one this turn. */
  readonly word: string | null;
  /** Host-clock delay before the submission should land. */
  readonly delayMs: number;
  /** An optional wrong answer to submit first, at roughly half the delay. */
  readonly fumble: string | null;
  /** How many candidates were examined. Surfaced in the dev overlay. */
  readonly examined: number;
}

export class Bot {
  private readonly profile: BotProfile;

  constructor(
    readonly difficulty: BotDifficulty,
    private readonly dict: Dictionary,
    private readonly rng: Rng,
    profile?: Partial<BotProfile>,
  ) {
    this.profile = { ...BOT_PROFILES[difficulty], ...profile };
  }

  /**
   * Decide a move for `syllable`.
   *
   * Cost is O(min(candidates, searchLimit)); for `impossible` the posting list
   * is walked once and the first known unused word wins, which measures in the
   * tens of microseconds on a 128k dictionary — well inside the "<10ms" budget
   * without needing a precomputed answer table.
   */
  decide(syllable: string, minWordLength: number, fuseMs: number): BotDecision {
    const think = this.thinkTime(fuseMs);

    if (this.rng.next() < this.profile.missChance) {
      return { word: null, delayMs: think, fumble: null, examined: 0 };
    }

    const { word, examined } = this.search(syllable, minWordLength);
    if (word === null) return { word: null, delayMs: think, fumble: null, examined };

    const fumble =
      this.rng.next() < this.profile.fumbleChance ? this.makeFumble(syllable) : null;

    return { word, delayMs: think, fumble, examined };
  }

  /**
   * Think time is clamped to the fuse so a slow bot does not "think" past the
   * explosion on a short fuse and appear to never try. Easy bots still lose on
   * short fuses — they are just not made artificially hopeless by them.
   */
  private thinkTime(fuseMs: number): number {
    const raw = this.rng.range(this.profile.minThinkMs, this.profile.maxThinkMs);
    const ceiling = Math.max(0, fuseMs - 250);
    return Math.min(raw, ceiling);
  }

  /**
   * Walk the posting list for `syllable`, keeping the best candidate the bot's
   * vocabulary admits. Reservoir-style selection with a length bias avoids
   * materialising and sorting the whole candidate array — on "ing" that would
   * be ten thousand strings per turn per bot.
   */
  private search(syllable: string, minWordLength: number): { word: string | null; examined: number } {
    const ids = this.dict.findWordIdsContaining(syllable);
    const table = this.dict.wordTable;
    const known = Math.max(1, Math.floor(table.length * this.profile.vocabularyFraction));

    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let examined = 0;

    for (let i = 0; i < ids.length; i += 1) {
      if (examined >= this.profile.searchLimit) break;
      const id = ids[i] as number;
      // Rank cut: ids are assigned in sorted order, so a low id is an
      // alphabetically early word, not a common one. Vocabulary membership is
      // therefore drawn from a stable hash of the id rather than the id itself,
      // which avoids giving every bot the same alphabetical bias.
      if (!this.knows(id, known, table.length)) continue;

      const word = table[id] as string;
      if (word.length < minWordLength) continue;
      if (!word.includes(syllable)) continue;
      if (this.dict.isUsed(word)) continue;

      examined += 1;
      const score = this.score(word);
      if (score < bestScore) {
        bestScore = score;
        best = word;
      }
    }
    return { word: best, examined };
  }

  /** Deterministic pseudo-membership: stable per (bot stream, word id). */
  private knows(id: number, known: number, total: number): boolean {
    if (known >= total) return true;
    // 32-bit mix so consecutive ids scatter across the unit interval.
    let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 < known / total;
  }

  /** Lower is better. Length bias plus a deterministic jitter to break ties. */
  private score(word: string): number {
    const bias = this.profile.shortWordBias;
    const jitter = this.rng.next() * (1 - bias) * 12;
    return word.length * bias + jitter;
  }

  /** A plausible-looking wrong answer: right shape, not in the dictionary. */
  private makeFumble(syllable: string): string | null {
    const filler = 'aeioustrn';
    const pad = () => filler[this.rng.int(filler.length)] as string;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = `${pad()}${syllable}${pad()}${pad()}`;
      if (!this.dict.has(candidate)) return candidate;
    }
    return null;
  }
}
