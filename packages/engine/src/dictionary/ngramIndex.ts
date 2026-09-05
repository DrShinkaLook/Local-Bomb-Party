/**
 * Inverted substring index over short n-grams.
 *
 * The game asks two questions constantly:
 *
 *   1. "Which words contain the substring ING?"   -> findWordsContaining
 *   2. "How many *unused* words still contain ING?" -> feasibility check for
 *      the syllable generator, and the difficulty signal for bots.
 *
 * A naive scan is O(N * L) over the whole dictionary — around 1.8 million
 * character comparisons per question at 128k words, far too slow to run every
 * turn, let alone once per candidate syllable when drawing a new prompt.
 *
 * So every distinct 2-gram and 3-gram is indexed to a sorted posting list of
 * word ids, built once at load. Lookup becomes a hash probe. Syllables longer
 * than `MAX_N` are answered by probing their first `MAX_N` characters and
 * filtering the (much smaller) candidate set.
 *
 * `availableCount` shadows each posting list with a live count that excludes
 * words already played this round. Marking a word used costs O(L) decrements
 * rather than a full reindex.
 */

export const MIN_N = 2;
export const MAX_N = 3;

export class NgramIndex {
  private readonly postings: Map<string, Int32Array>;
  private readonly available: Map<string, number>;

  private constructor(postings: Map<string, Int32Array>) {
    this.postings = postings;
    this.available = new Map();
    for (const [gram, list] of postings) this.available.set(gram, list.length);
  }

  /**
   * Build from a word table. `words[i]` must be lowercase a-z.
   *
   * Two passes: the first counts occurrences so each posting list can be
   * allocated at its exact size, the second fills them. This avoids the
   * churn of growing 18k JavaScript arrays and then converting each one.
   */
  static build(words: readonly string[]): NgramIndex {
    const counts = new Map<string, number>();
    const seen = new Set<string>();

    for (const word of words) {
      seen.clear();
      for (let n = MIN_N; n <= MAX_N; n += 1) {
        for (let i = 0; i + n <= word.length; i += 1) {
          const gram = word.slice(i, i + n);
          if (seen.has(gram)) continue;
          seen.add(gram);
          counts.set(gram, (counts.get(gram) ?? 0) + 1);
        }
      }
    }

    const postings = new Map<string, Int32Array>();
    const cursors = new Map<string, number>();
    for (const [gram, count] of counts) {
      postings.set(gram, new Int32Array(count));
      cursors.set(gram, 0);
    }

    for (let id = 0; id < words.length; id += 1) {
      const word = words[id] as string;
      seen.clear();
      for (let n = MIN_N; n <= MAX_N; n += 1) {
        for (let i = 0; i + n <= word.length; i += 1) {
          const gram = word.slice(i, i + n);
          if (seen.has(gram)) continue;
          seen.add(gram);
          const at = cursors.get(gram) as number;
          (postings.get(gram) as Int32Array)[at] = id;
          cursors.set(gram, at + 1);
        }
      }
    }

    // Ids are appended in ascending order, so every posting list is already
    // sorted — callers may rely on that for merge-style intersections.
    return new NgramIndex(postings);
  }

  /** Every distinct indexed n-gram. */
  grams(): IterableIterator<string> {
    return this.postings.keys();
  }

  /** Total words containing `gram`, ignoring used-word state. -1 if unindexed. */
  totalFor(gram: string): number {
    const list = this.postings.get(gram);
    return list === undefined ? -1 : list.length;
  }

  /** Words containing `gram` that have not been consumed this round. */
  availableFor(gram: string): number {
    return this.available.get(gram) ?? 0;
  }

  /** Posting list for an indexed gram, or an empty view. */
  postingsFor(gram: string): Int32Array {
    return this.postings.get(gram) ?? EMPTY;
  }

  /** Whether `gram` is short enough to have its own posting list. */
  static isIndexable(gram: string): boolean {
    return gram.length >= MIN_N && gram.length <= MAX_N;
  }

  /**
   * Decrement the availability counters for every distinct indexed n-gram of
   * `word`. Call exactly once per word, when it is consumed.
   */
  markUsed(word: string): void {
    this.adjust(word, -1);
  }

  /** Inverse of `markUsed`, for round resets and mod reloads. */
  markUnused(word: string): void {
    this.adjust(word, 1);
  }

  private adjust(word: string, delta: number): void {
    const seen = new Set<string>();
    for (let n = MIN_N; n <= MAX_N; n += 1) {
      for (let i = 0; i + n <= word.length; i += 1) {
        const gram = word.slice(i, i + n);
        if (seen.has(gram)) continue;
        seen.add(gram);
        const current = this.available.get(gram);
        if (current !== undefined) this.available.set(gram, current + delta);
      }
    }
  }

  /** Reset all availability counters to their full totals. */
  resetAvailability(): void {
    for (const [gram, list] of this.postings) this.available.set(gram, list.length);
  }

  /**
   * Rebuild from a serialised form. `grams[i]`'s posting list is the slice
   * `postings[postingStart[i] .. postingStart[i + 1])` — the same CSR layout
   * the trie uses, so the whole index restores as typed-array views with no
   * per-entry parsing.
   */
  static fromBuffers(
    grams: readonly string[],
    postingStart: Uint32Array,
    postings: Int32Array,
  ): NgramIndex {
    const map = new Map<string, Int32Array>();
    for (let i = 0; i < grams.length; i += 1) {
      const from = postingStart[i] as number;
      const to = postingStart[i + 1] as number;
      map.set(grams[i] as string, postings.subarray(from, to));
    }
    return new NgramIndex(map);
  }

  /** Serialise to the CSR triple `fromBuffers` expects. */
  toBuffers(): { grams: string[]; postingStart: Uint32Array; postings: Int32Array } {
    const grams = Array.from(this.postings.keys());
    const postingStart = new Uint32Array(grams.length + 1);
    let total = 0;
    for (let i = 0; i < grams.length; i += 1) {
      postingStart[i] = total;
      total += (this.postings.get(grams[i] as string) as Int32Array).length;
    }
    postingStart[grams.length] = total;

    const postings = new Int32Array(total);
    for (let i = 0; i < grams.length; i += 1) {
      postings.set(this.postings.get(grams[i] as string) as Int32Array, postingStart[i] as number);
    }
    return { grams, postingStart, postings };
  }
}

const EMPTY = new Int32Array(0);
