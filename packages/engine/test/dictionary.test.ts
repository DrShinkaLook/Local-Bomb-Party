import { describe, expect, it } from './harness.js';
import { fullDictionary, tinyDictionary } from './fixtures.js';
import { Dictionary } from '../src/dictionary/dictionary.js';
import { TrieBuilder } from '../src/dictionary/trie.js';
import { NgramIndex } from '../src/dictionary/ngramIndex.js';

describe('CompiledTrie', () => {
  it('finds inserted words and rejects absent ones', () => {
    const builder = new TrieBuilder();
    ['cat', 'car', 'cart', 'dog'].forEach((w, i) => builder.insert(w, i));
    const trie = builder.compile();

    expect(trie.has('cat')).toBe(true);
    expect(trie.has('cart')).toBe(true);
    expect(trie.has('ca')).toBe(false);
    expect(trie.has('cats')).toBe(false);
    expect(trie.has('')).toBe(false);
  });

  it('preserves the word id it was given', () => {
    const builder = new TrieBuilder();
    builder.insert('alpha', 7);
    builder.insert('beta', 42);
    const trie = builder.compile();
    expect(trie.lookup('alpha')).toBe(7);
    expect(trie.lookup('beta')).toBe(42);
    expect(trie.lookup('gamma')).toBe(-1);
  });

  it('answers prefix queries', () => {
    const builder = new TrieBuilder();
    ['cat', 'car', 'cart'].forEach((w, i) => builder.insert(w, i));
    const trie = builder.compile();
    expect(trie.hasPrefix('ca')).toBe(true);
    expect(trie.hasPrefix('cx')).toBe(false);
    expect(trie.collectPrefix('car', 10).length).toBe(2);
  });

  it('rejects characters outside a-z without throwing', () => {
    const builder = new TrieBuilder();
    builder.insert('cat', 0);
    const trie = builder.compile();
    expect(trie.has('c4t')).toBe(false);
    expect(trie.has('CAT')).toBe(false);
  });
});

describe('NgramIndex', () => {
  it('indexes each word once per distinct gram', () => {
    // "banana" contains "an" twice; the posting list must not list it twice.
    const index = NgramIndex.build(['banana', 'band', 'can']);
    expect(index.totalFor('an')).toBe(3);
    expect(index.postingsFor('an').length).toBe(3);
  });

  it('tracks availability as words are consumed', () => {
    const index = NgramIndex.build(['ring', 'sing', 'king']);
    expect(index.availableFor('ing')).toBe(3);
    index.markUsed('ring');
    expect(index.availableFor('ing')).toBe(2);
    expect(index.totalFor('ing')).toBe(3);
    index.markUnused('ring');
    expect(index.availableFor('ing')).toBe(3);
  });

  it('returns posting lists in ascending id order', () => {
    const index = NgramIndex.build(['aing', 'bing', 'cing', 'ding']);
    const postings = Array.from(index.postingsFor('ing'));
    expect(postings).toEqual([0, 1, 2, 3]);
  });
});

describe('Dictionary.validateWord', () => {
  const dict = tinyDictionary();

  it('accepts a word containing the syllable', () => {
    expect(dict.validateWord('string', 'ring', 3)).toEqual({ ok: true, word: 'string' });
  });

  it('normalises case and surrounding whitespace', () => {
    expect(dict.validateWord('  STRING  ', 'ring', 3)).toEqual({ ok: true, word: 'string' });
  });

  it('reports the most specific failure reason', () => {
    expect(dict.validateWord('', 'ring', 3)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(dict.validateWord('ri2ng', 'ring', 3)).toEqual({ ok: false, reason: 'NON_ALPHABETIC' });
    expect(dict.validateWord('at', 'at', 3)).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(dict.validateWord('dogma', 'ring', 3)).toEqual({
      ok: false,
      reason: 'MISSING_SYLLABLE',
    });
    expect(dict.validateWord('ringzz', 'ring', 3)).toEqual({ ok: false, reason: 'NOT_A_WORD' });
  });

  it('rejects a word already played this round', () => {
    const local = tinyDictionary();
    expect(local.validateWord('string', 'ring', 3).ok).toBe(true);
    local.removeUsedWords('string');
    expect(local.validateWord('string', 'ring', 3)).toEqual({
      ok: false,
      reason: 'ALREADY_USED',
    });
  });
});

describe('Dictionary substring queries', () => {
  it('finds every unused word containing a syllable', () => {
    const dict = tinyDictionary();
    const found = dict.findWordsContaining('ring').sort();
    expect(found).toEqual(['bring', 'brings', 'ring', 'ringing', 'rings', 'string', 'stringing', 'strings']);
  });

  it('excludes consumed words from results and counts', () => {
    const dict = tinyDictionary();
    const before = dict.countAvailable('ing');
    dict.removeUsedWords('string');
    expect(dict.countAvailable('ing')).toBe(before - 1);
    expect(dict.findWordsContaining('ing').includes('string')).toBe(false);
  });

  it('handles syllables longer than the index width', () => {
    const dict = tinyDictionary();
    // "ringi" is 5 characters; the index only holds 2- and 3-grams.
    expect(dict.findWordsContaining('ringi').sort()).toEqual(['ringing', 'stringing']);
  });

  it('is idempotent when the same word is consumed twice', () => {
    const dict = tinyDictionary();
    const before = dict.countAvailable('ing');
    dict.removeUsedWords('string');
    dict.removeUsedWords('string');
    expect(dict.countAvailable('ing')).toBe(before - 1);
  });

  it('restores state on reset', () => {
    const dict = tinyDictionary();
    const before = dict.countAvailable('ing');
    dict.removeUsedWords('string');
    dict.removeUsedWords('ring');
    dict.resetUsed();
    expect(dict.countAvailable('ing')).toBe(before);
    expect(dict.remaining).toBe(dict.size);
  });
});

describe('Dictionary construction', () => {
  it('drops non-alphabetic and short entries', () => {
    const dict = Dictionary.fromWordList(
      ['cat', 'CAT', ' cat ', "don't", 'co-op', 'a', 'x9', 'dog'],
      { minLength: 2 },
    );
    expect(dict.size).toBe(2);
    expect(dict.has('cat')).toBe(true);
    expect(dict.has('dog')).toBe(true);
  });

  it('scales to the shipped word list', () => {
    const dict = fullDictionary();
    expect(dict.size).toBeGreaterThan(100_000);
    expect(dict.has('striking')).toBe(true);
    expect(dict.has('zzzzzz')).toBe(false);
  });

  it('answers a million membership queries in well under a second', () => {
    const dict = fullDictionary();
    const started = Date.now();
    let hits = 0;
    for (let i = 0; i < 1_000_000; i += 1) hits += dict.has('striking') ? 1 : 0;
    const elapsed = Date.now() - started;
    expect(hits).toBe(1_000_000);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe('Binary dictionary format', () => {
  it('round-trips a small dictionary exactly', () => {
    const original = tinyDictionary();
    const restored = Dictionary.fromBinary(original.toBinary());

    expect(restored.size).toBe(original.size);
    expect(restored.has('concatenate')).toBe(true);
    expect(restored.has('nonsense')).toBe(false);
    expect(restored.findWordsContaining('ring').sort()).toEqual(
      original.findWordsContaining('ring').sort(),
    );
    expect(restored.countAvailable('ing')).toBe(original.countAvailable('ing'));
  });

  it('round-trips the shipped dictionary and loads far faster than a rebuild', () => {
    const original = fullDictionary();
    const buffer = original.toBinary();

    const started = Date.now();
    const restored = Dictionary.fromBinary(buffer);
    const restoreMs = Date.now() - started;

    expect(restored.size).toBe(original.size);
    expect(restored.has('striking')).toBe(true);
    expect(restored.countTotal('ing')).toBe(original.countTotal('ing'));
    // A text rebuild is ~1s; the binary path must be an order of magnitude
    // cheaper or it is not worth the format.
    expect(restoreMs).toBeLessThan(300);
  });

  it('keeps used-word state out of the serialised form', () => {
    const original = tinyDictionary();
    original.removeUsedWords('string');
    const restored = Dictionary.fromBinary(original.toBinary());
    // The table describes the language, not the round in progress.
    expect(restored.isUsed('string')).toBe(false);
  });

  it('refuses a corrupt or foreign buffer', () => {
    expect(() => Dictionary.fromBinary(new ArrayBuffer(64))).toThrow();
  });
});
