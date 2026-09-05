#!/usr/bin/env node
/**
 * Optional: replace the bundled word list with a larger open one.
 *
 * The repository ships a ~128k-word list expanded from SCOWL, which is fully
 * offline and permissively licensed. If you want the ~200k-370k range, this
 * script fetches a larger public-domain list, filters it to the game alphabet,
 * and writes it beside the default.
 *
 * Sources are public-domain or permissively licensed word data only. This
 * project does not take word lists, syllable pools, or any other data from a
 * third-party game service — see docs/CLEAN-ROOM.md.
 *
 *   node tools/fetch-dictionary.mjs [--source enable|dwyl] [--out data/words-en.txt]
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const SOURCES = {
  // ENABLE: released into the public domain by Alan Beale.
  enable: {
    url: 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
    licence: 'Public domain (ENABLE, Alan Beale)',
    expect: 170_000,
  },
  // dwyl/english-words: Unlicense. Largest, noisiest.
  dwyl: {
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    licence: 'Unlicense (dwyl/english-words)',
    expect: 350_000,
  },
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const sourceName = flag('source', 'enable');
const outPath = resolve(process.cwd(), flag('out', 'data/words-en.txt'));
const source = SOURCES[sourceName];

if (source === undefined) {
  console.error(`Unknown source "${sourceName}". Options: ${Object.keys(SOURCES).join(', ')}`);
  process.exit(1);
}

const tmpPath = `${outPath}.download`;

console.log(`Fetching ${sourceName} from ${source.url}`);
console.log(`Licence: ${source.licence}`);

const response = await fetch(source.url);
if (!response.ok || response.body === null) {
  console.error(`Download failed: HTTP ${response.status}`);
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
await pipeline(response.body, createWriteStream(tmpPath));

const raw = await readFile(tmpPath, 'utf8');
await rm(tmpPath);

// Same normalisation the engine applies at load, done once here so the shipped
// file is exactly what the game will use.
const words = new Set();
for (const line of raw.split(/\r?\n/)) {
  const word = line.trim().toLowerCase();
  if (word.length < 2) continue;
  if (!/^[a-z]+$/.test(word)) continue;
  words.add(word);
}

const sorted = [...words].sort();
const { writeFile } = await import('node:fs/promises');
await writeFile(outPath, `${sorted.join('\n')}\n`, 'utf8');

const info = await stat(outPath);
console.log(`Wrote ${sorted.length.toLocaleString()} words to ${outPath} (${(info.size / 1e6).toFixed(1)} MB)`);
if (sorted.length < source.expect * 0.8) {
  console.warn('Warning: fewer words than expected — the upstream file may have changed.');
}
console.log('\nDelete the cached binary table so it rebuilds on next launch:');
console.log('  the app rebuilds automatically when the word file changes size or content.');
