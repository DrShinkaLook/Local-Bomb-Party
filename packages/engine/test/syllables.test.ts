import { describe, expect, it } from './harness.js';
import { fullDictionary, tinyDictionary } from './fixtures.js';
import { SyllableGenerator } from '../src/dictionary/syllables.js';
import { Rng } from '../src/util/rng.js';

describe('SyllableGenerator', () => {
  it('derives non-empty pools from the shipped dictionary', () => {
    const gen = new SyllableGenerator(fullDictionary(), { minWords: 60 });
    const sizes = gen.poolSizes();
    expect(sizes.common).toBeGreaterThan(50);
    expect(sizes.uncommon).toBeGreaterThan(50);
    expect(sizes.rare).toBeGreaterThan(50);
  });

  it('orders tiers by decreasing word coverage', () => {
    const dict = fullDictionary();
    const gen = new SyllableGenerator(dict, { minWords: 60 });
    const avg = (grams: string[]) =>
      grams.reduce((sum, g) => sum + dict.countTotal(g), 0) / Math.max(1, grams.length);

    const common = avg(gen.peekPool('common', 100));
    const uncommon = avg(gen.peekPool('uncommon', 100));
    const rare = avg(gen.peekPool('rare', 100));

    expect(common).toBeGreaterThan(uncommon);
    expect(uncommon).toBeGreaterThan(rare);
  });

  it('never issues a syllable the dictionary cannot satisfy', () => {
    const dict = fullDictionary();
    const gen = new SyllableGenerator(dict, { minWords: 60 });
    const rng = new Rng('feasibility');

    for (const tier of ['common', 'uncommon', 'rare'] as const) {
      for (let i = 0; i < 400; i += 1) {
        const syllable = gen.getRandomSyllable(tier, rng, 60);
        expect(dict.countAvailable(syllable)).toBeGreaterThanOrEqual(60);
        expect(dict.findWordsContaining(syllable, 1).length).toBe(1);
      }
    }
  });

  it('stays feasible as the word pool is consumed', () => {
    const dict = fullDictionary();
    const gen = new SyllableGenerator(dict, { minWords: 20 });
    const rng = new Rng('drain');

    // Burn through several thousand words, re-checking feasibility throughout.
    for (let round = 0; round < 300; round += 1) {
      const syllable = gen.getRandomSyllable('common', rng, 20);
      const candidates = dict.findWordsContaining(syllable, 12);
      expect(candidates.length).toBeGreaterThan(0);
      for (const word of candidates) dict.removeUsedWords(word);
    }
    dict.resetUsed();
  });

  it('rejects grams that are neither vowel-bearing nor real onsets', () => {
    const gen = new SyllableGenerator(fullDictionary(), { minWords: 60 });
    const all = [
      ...gen.peekPool('common', 5_000),
      ...gen.peekPool('uncommon', 5_000),
      ...gen.peekPool('rare', 5_000),
    ];
    // "rp" and "hs" occur in thousands of words but only across syllable
    // boundaries, so they must not survive the well-formedness filter.
    expect(all.includes('rp')).toBe(false);
    expect(all.includes('hs')).toBe(false);
    // "st" is vowelless but a genuine onset, so it must survive.
    expect(all.includes('st')).toBe(true);
  });

  it('avoids repeating a syllable inside the history window', () => {
    const gen = new SyllableGenerator(fullDictionary(), { minWords: 60, historySize: 6 });
    const rng = new Rng('history');
    const seen: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const syllable = gen.getRandomSyllable('common', rng, 60);
      expect(seen.slice(-6).includes(syllable)).toBe(false);
      seen.push(syllable);
    }
  });

  it('is deterministic for a given seed', () => {
    const dict = fullDictionary();
    const draw = (seed: string) => {
      const gen = new SyllableGenerator(dict, { minWords: 60 });
      const rng = new Rng(seed);
      return Array.from({ length: 25 }, () => gen.getRandomSyllable('uncommon', rng, 60));
    };
    expect(draw('same-seed').join(',')).toBe(draw('same-seed').join(','));
    expect(draw('seed-a').join(',') === draw('seed-b').join(',')).toBe(false);
  });

  it('reshapes its pools for a mod word list', () => {
    // The tiny fixture has no words containing "sh", so "sh" must never appear.
    const gen = new SyllableGenerator(tinyDictionary(), { minWords: 2, minOnsetWords: 1 });
    const all = [
      ...gen.peekPool('common', 500),
      ...gen.peekPool('uncommon', 500),
      ...gen.peekPool('rare', 500),
    ];
    expect(all.includes('sh')).toBe(false);
    expect(all.includes('ing')).toBe(true);
  });
});
