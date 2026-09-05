import { readFileSync } from 'node:fs';
import { Dictionary } from '../src/dictionary/dictionary.js';
import { SyllableGenerator } from '../src/dictionary/syllables.js';
import { Rng } from '../src/util/rng.js';

const t0 = Date.now();
const lines = readFileSync(new URL('../../../data/words-en.txt', import.meta.url), 'utf8').split('\n');
const dict = Dictionary.fromWordList(lines, { minLength: 2 });
const t1 = Date.now();
console.log('dictionary load ms:', t1 - t0, dict.stats());

const gen = new SyllableGenerator(dict, { minWords: 60 });
const t2 = Date.now();
console.log('syllable pool build ms:', t2 - t1, gen.poolSizes());
console.log('common :', gen.peekPool('common', 14).join(' '));
console.log('uncommon:', gen.peekPool('uncommon', 14).join(' '));
console.log('rare   :', gen.peekPool('rare', 14).join(' '));

const rng = new Rng('smoke-seed');
const draws = Array.from({ length: 10 }, () => gen.getRandomSyllable('common', rng));
console.log('draws:', draws.join(' '));
for (const d of draws) {
  const n = dict.countAvailable(d);
  if (n < 60) throw new Error(`infeasible syllable ${d} (${n})`);
}

console.log('valid  :', JSON.stringify(dict.validateWord('striking', 'ing', 3)));
console.log('nosyll :', JSON.stringify(dict.validateWord('striking', 'xyz', 3)));
console.log('nonword:', JSON.stringify(dict.validateWord('qqqqz', 'qq', 3)));
console.log('short  :', JSON.stringify(dict.validateWord('ab', 'ab', 3)));

const t3 = Date.now();
let hits = 0;
for (let i = 0; i < 1_000_000; i += 1) hits += dict.has('striking') ? 1 : 0;
console.log('1M membership lookups ms:', Date.now() - t3, `(hits ${hits})`);

const t4 = Date.now();
const found = dict.findWordsContaining('ing');
console.log(`findWordsContaining("ing") -> ${found.length} words in ${Date.now() - t4}ms`);

const t5 = Date.now();
for (let i = 0; i < 10_000; i += 1) dict.countAvailable('ing');
console.log('10k feasibility counts ms:', Date.now() - t5);

dict.removeUsedWords('striking');
console.log('after use:', JSON.stringify(dict.validateWord('striking', 'ing', 3)), 'remaining', dict.remaining);
