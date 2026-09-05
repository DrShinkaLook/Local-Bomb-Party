import { CompiledTrie } from './trie.js';
import { NgramIndex } from './ngramIndex.js';

/**
 * Preprocessed binary lookup table.
 *
 * Building the dictionary from a text file costs roughly a second: parse, sort,
 * insert 128k words into a trie, then walk every n-gram twice. Doing that on
 * every launch is a second of a cold, empty window.
 *
 * So it is done once, at build time or first run, and the result is written out
 * as a single buffer of length-prefixed typed-array sections. Loading is then
 * `new Uint32Array(buffer, offset, length)` per section — views over bytes that
 * are already in memory, with no per-word work at all. The only decode step is
 * the word blob, and that is one `TextDecoder` pass over ~1.2MB.
 *
 * Layout (little-endian, every section 4-byte aligned):
 *
 *   magic 'BPDX' | u32 version | u32 wordCount | u32 blobBytes
 *   u32 trieNodes | u32 trieEdges | u32 gramCount | u32 postingCount
 *   u32 gramBlobBytes | u32 reserved
 *   --- sections ---
 *   wordBlob      : Uint8Array[blobBytes]        (words joined by '\n')
 *   childStart    : Uint32Array[trieNodes + 1]
 *   childLetter   : Uint8Array[trieEdges]
 *   childNode     : Uint32Array[trieEdges]
 *   wordId        : Int32Array[trieNodes]
 *   gramBlob      : Uint8Array[gramBlobBytes]    (grams joined by '\n')
 *   postingStart  : Uint32Array[gramCount + 1]
 *   postings      : Int32Array[postingCount]
 */

/**
 * `TextEncoder`/`TextDecoder` are WHATWG APIs, present in every runtime this
 * ships to but absent from `lib: ["ES2022"]`. Declaring the two methods used
 * here keeps the engine free of a DOM or Node lib dependency rather than
 * relaxing the compiler settings that enforce it.
 */
interface TextCodecs {
  TextEncoder: new () => { encode(input: string): Uint8Array };
  TextDecoder: new () => { decode(input: Uint8Array): string };
}
const { TextEncoder, TextDecoder } = globalThis as unknown as TextCodecs;

const MAGIC = 0x58445042; // 'BPDX' little-endian
export const BINARY_FORMAT_VERSION = 1;

const HEADER_BYTES = 40;
const align4 = (n: number): number => (n + 3) & ~3;

export interface DictionaryParts {
  readonly words: readonly string[];
  readonly trie: CompiledTrie;
  readonly index: NgramIndex;
}

export const serializeDictionary = (parts: DictionaryParts): ArrayBuffer => {
  const encoder = new TextEncoder();
  const wordBlob = encoder.encode(parts.words.join('\n'));
  const [childStart, childLetter, childNode, wordId] = parts.trie.toBuffers();
  const { grams, postingStart, postings } = parts.index.toBuffers();
  const gramBlob = encoder.encode(grams.join('\n'));

  const sections: (Uint8Array | Uint32Array | Int32Array)[] = [
    wordBlob,
    childStart,
    childLetter,
    childNode,
    wordId,
    gramBlob,
    postingStart,
    postings,
  ];

  let total = HEADER_BYTES;
  for (const section of sections) total = align4(total) + section.byteLength;

  const buffer = new ArrayBuffer(align4(total));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint32(4, BINARY_FORMAT_VERSION, true);
  view.setUint32(8, parts.words.length, true);
  view.setUint32(12, wordBlob.byteLength, true);
  view.setUint32(16, wordId.length, true);
  view.setUint32(20, childLetter.length, true);
  view.setUint32(24, grams.length, true);
  view.setUint32(28, postings.length, true);
  view.setUint32(32, gramBlob.byteLength, true);
  view.setUint32(36, 0, true);

  let cursor = HEADER_BYTES;
  for (const section of sections) {
    cursor = align4(cursor);
    bytes.set(
      new Uint8Array(section.buffer, section.byteOffset, section.byteLength),
      cursor,
    );
    cursor += section.byteLength;
  }
  return buffer;
};

export interface DeserializedDictionary {
  readonly words: string[];
  readonly trie: CompiledTrie;
  readonly index: NgramIndex;
}

export const deserializeDictionary = (buffer: ArrayBuffer): DeserializedDictionary => {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new Error('not a Bomb Party dictionary file');
  }
  const version = view.getUint32(4, true);
  if (version !== BINARY_FORMAT_VERSION) {
    throw new Error(
      `dictionary format v${version} is not readable by this build (expected v${BINARY_FORMAT_VERSION})`,
    );
  }

  const wordCount = view.getUint32(8, true);
  const blobBytes = view.getUint32(12, true);
  const trieNodes = view.getUint32(16, true);
  const trieEdges = view.getUint32(20, true);
  const gramCount = view.getUint32(24, true);
  const postingCount = view.getUint32(28, true);
  const gramBlobBytes = view.getUint32(32, true);

  let cursor = HEADER_BYTES;
  const take = <T>(make: (offset: number) => T, byteLength: number): T => {
    cursor = align4(cursor);
    const result = make(cursor);
    cursor += byteLength;
    return result;
  };

  const decoder = new TextDecoder();
  const wordBlob = take((o) => new Uint8Array(buffer, o, blobBytes), blobBytes);
  const childStart = take(
    (o) => new Uint32Array(buffer, o, trieNodes + 1),
    (trieNodes + 1) * 4,
  );
  const childLetter = take((o) => new Uint8Array(buffer, o, trieEdges), trieEdges);
  const childNode = take((o) => new Uint32Array(buffer, o, trieEdges), trieEdges * 4);
  const wordId = take((o) => new Int32Array(buffer, o, trieNodes), trieNodes * 4);
  const gramBlob = take((o) => new Uint8Array(buffer, o, gramBlobBytes), gramBlobBytes);
  const postingStart = take(
    (o) => new Uint32Array(buffer, o, gramCount + 1),
    (gramCount + 1) * 4,
  );
  const postings = take((o) => new Int32Array(buffer, o, postingCount), postingCount * 4);

  const words = blobBytes === 0 ? [] : decoder.decode(wordBlob).split('\n');
  if (words.length !== wordCount) {
    throw new Error(`dictionary is corrupt: expected ${wordCount} words, decoded ${words.length}`);
  }
  const grams = gramBlobBytes === 0 ? [] : decoder.decode(gramBlob).split('\n');

  return {
    words,
    trie: CompiledTrie.fromBuffers(childStart, childLetter, childNode, wordId),
    index: NgramIndex.fromBuffers(grams, postingStart, postings),
  };
};
