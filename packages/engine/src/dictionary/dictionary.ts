import type { ValidationResult } from '../types.js';
import { CompiledTrie, TrieBuilder, isLowerAlpha } from './trie.js';
import { MAX_N, MIN_N, NgramIndex } from './ngramIndex.js';
import { deserializeDictionary, serializeDictionary } from './binary.js';

/**
 * The dictionary the game plays against.
 *
 * Owns three things:
 *   - the canonical word table (`words[id]`),
 *   - a compiled trie for O(k) membership,
 *   - an n-gram inverted index for substring queries and feasibility counts,
 * plus a bitset of words consumed during the current round.
 *
 * Construction is the expensive part (a few hundred milliseconds for 128k
 * words). It is intended to run once, off the UI thread — see
 * `loadDictionaryInWorker` in the desktop app.
 */
export interface DictionaryOptions {
  /** Words shorter than this are dropped at load rather than rejected at play. */
  readonly minLength?: number;
}

export class Dictionary {
  private readonly words: readonly string[];
  private readonly trie: CompiledTrie;
  private readonly index: NgramIndex;
  /** 1 = consumed this round. Uint8Array beats Set<string> on both time and space. */
  private readonly used: Uint8Array;
  private usedCount = 0;

  private constructor(words: readonly string[], trie: CompiledTrie, index: NgramIndex) {
    this.words = words;
    this.trie = trie;
    this.index = index;
    this.used = new Uint8Array(words.length);
  }

  /**
   * Build from raw lines. Input is normalised (trimmed, lowercased),
   * de-duplicated, and filtered to pure a-z — the game alphabet has no room
   * for hyphens, apostrophes, or digits.
   */
  static fromWordList(lines: Iterable<string>, options: DictionaryOptions = {}): Dictionary {
    const minLength = options.minLength ?? 2;
    const unique = new Set<string>();

    for (const line of lines) {
      const word = line.trim().toLowerCase();
      if (word.length < minLength) continue;
      if (!isLowerAlpha(word)) continue;
      unique.add(word);
    }

    const words = Array.from(unique).sort();
    const builder = new TrieBuilder();
    for (let id = 0; id < words.length; id += 1) builder.insert(words[id] as string, id);

    return new Dictionary(words, builder.compile(), NgramIndex.build(words));
  }

  /**
   * Restore from a preprocessed binary table. This is the launch path: the
   * sections become typed-array views over the buffer, so the only real work is
   * one TextDecoder pass over the word blob.
   */
  static fromBinary(buffer: ArrayBuffer): Dictionary {
    const { words, trie, index } = deserializeDictionary(buffer);
    return new Dictionary(words, trie, index);
  }

  /** Serialise for `fromBinary`. Run once at build time or first launch. */
  toBinary(): ArrayBuffer {
    return serializeDictionary({ words: this.words, trie: this.trie, index: this.index });
  }

  get size(): number {
    return this.words.length;
  }

  get remaining(): number {
    return this.words.length - this.usedCount;
  }

  /** Direct membership test, ignoring syllable and used-word state. */
  has(word: string): boolean {
    return this.trie.has(word.trim().toLowerCase());
  }

  wordAt(id: number): string | undefined {
    return this.words[id];
  }

  /**
   * Validate a submission against the active syllable.
   *
   * Ordering matters: cheap structural checks run before the trie probe, and
   * the trie probe runs before the used-word check, so the failure reason
   * reported to the player is the most specific one available.
   */
  validateWord(word: string, currentSyllable: string, minWordLength = 2): ValidationResult {
    const normalised = word.trim().toLowerCase();

    if (normalised.length === 0) return { ok: false, reason: 'EMPTY' };
    if (!isLowerAlpha(normalised)) return { ok: false, reason: 'NON_ALPHABETIC' };
    if (normalised.length < minWordLength) return { ok: false, reason: 'TOO_SHORT' };

    const syllable = currentSyllable.trim().toLowerCase();
    if (syllable.length > 0 && !normalised.includes(syllable)) {
      return { ok: false, reason: 'MISSING_SYLLABLE' };
    }

    const id = this.trie.lookup(normalised);
    if (id < 0) return { ok: false, reason: 'NOT_A_WORD' };
    if (this.used[id] === 1) return { ok: false, reason: 'ALREADY_USED' };

    return { ok: true, word: normalised };
  }

  /**
   * Every unused word containing `syllable`, capped at `limit`.
   *
   * For an indexed syllable (2-3 characters) this is a hash probe plus a scan
   * of the posting list. For a longer one it probes the leading 3-gram and
   * filters, which is still orders of magnitude cheaper than a full scan.
   */
  findWordsContaining(syllable: string, limit = Number.POSITIVE_INFINITY): string[] {
    const gram = syllable.trim().toLowerCase();
    if (gram.length < MIN_N) return [];

    const probe = gram.length <= MAX_N ? gram : gram.slice(0, MAX_N);
    const needsFilter = gram.length > MAX_N;
    const postings = this.index.postingsFor(probe);
    const out: string[] = [];

    for (let i = 0; i < postings.length && out.length < limit; i += 1) {
      const id = postings[i] as number;
      if (this.used[id] === 1) continue;
      const word = this.words[id] as string;
      if (needsFilter && !word.includes(gram)) continue;
      out.push(word);
    }
    return out;
  }

  /** Word ids rather than strings — the allocation-free path bots use. */
  findWordIdsContaining(syllable: string): Int32Array {
    const gram = syllable.trim().toLowerCase();
    if (gram.length < MIN_N) return new Int32Array(0);
    return this.index.postingsFor(gram.length <= MAX_N ? gram : gram.slice(0, MAX_N));
  }

  /**
   * How many unused words still contain `syllable`.
   *
   * O(1) for an indexed syllable. This is what makes the "never offer an
   * impossible prompt" guarantee affordable: the generator can test hundreds
   * of candidates per draw without touching the word table.
   */
  countAvailable(syllable: string): number {
    const gram = syllable.trim().toLowerCase();
    if (NgramIndex.isIndexable(gram)) return this.index.availableFor(gram);
    return this.findWordsContaining(gram).length;
  }

  /** Total words containing `syllable`, ignoring used-word state. */
  countTotal(syllable: string): number {
    const gram = syllable.trim().toLowerCase();
    if (NgramIndex.isIndexable(gram)) return Math.max(0, this.index.totalFor(gram));
    return this.findWordsContaining(gram).length;
  }

  isUsed(word: string): boolean {
    const id = this.trie.lookup(word.trim().toLowerCase());
    return id >= 0 && this.used[id] === 1;
  }

  /**
   * Consume a word so it cannot be replayed this round.
   *
   * Named `removeUsedWords` for API compatibility with the original prototype's
   * dictionary contract; it removes a single word from the available pool.
   * Idempotent.
   */
  removeUsedWords(word: string): void {
    const normalised = word.trim().toLowerCase();
    const id = this.trie.lookup(normalised);
    if (id < 0 || this.used[id] === 1) return;
    this.used[id] = 1;
    this.usedCount += 1;
    this.index.markUsed(normalised);
  }

  /** Restore a consumed word (round reset, rollback, undo). */
  restoreWord(word: string): void {
    const normalised = word.trim().toLowerCase();
    const id = this.trie.lookup(normalised);
    if (id < 0 || this.used[id] === 0) return;
    this.used[id] = 0;
    this.usedCount -= 1;
    this.index.markUnused(normalised);
  }

  /** Clear all used-word state. Called between rounds. */
  resetUsed(): void {
    this.used.fill(0);
    this.usedCount = 0;
    this.index.resetAvailability();
  }

  /** Prefix completions, for typeahead and debugging. Not used in scoring. */
  completePrefix(prefix: string, limit = 20): string[] {
    return this.trie
      .collectPrefix(prefix.trim().toLowerCase(), limit)
      .map((id) => this.words[id] as string);
  }

  /** Read-only view of the word table, for bot vocabulary slicing. */
  get wordTable(): readonly string[] {
    return this.words;
  }

  /** Diagnostics surfaced in the dev overlay. */
  stats(): { words: number; used: number; trieNodes: number; grams: number } {
    let grams = 0;
    for (const _ of this.index.grams()) grams += 1;
    return {
      words: this.words.length,
      used: this.usedCount,
      trieNodes: this.trie.nodeCount,
      grams,
    };
  }
}
