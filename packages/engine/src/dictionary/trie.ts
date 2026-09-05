/**
 * A compact prefix trie over the lowercase ASCII alphabet.
 *
 * Two representations exist:
 *
 *  - `TrieBuilder` — a pointer/Map structure used only while ingesting words.
 *    Convenient, allocation-heavy, discarded after `compile()`.
 *  - `CompiledTrie` — a CSR (compressed sparse row) encoding backed entirely by
 *    typed arrays. Children of node `n` live in the half-open slice
 *    `[childStart[n], childStart[n + 1])` of the parallel `childLetter` /
 *    `childNode` arrays, sorted by letter.
 *
 * The CSR form is what ships. It is contiguous, cache-friendly, has no
 * per-node object overhead, and serialises to a byte buffer with zero parsing
 * on load — the renderer maps the buffer and starts querying.
 *
 * Lookup is O(k) in the length of the query: at most 26 children per node are
 * scanned, which is a bounded constant, so the alphabet size does not enter the
 * asymptotic cost.
 */

const A = 97; // 'a'
const ALPHABET = 26;

export const isLowerAlpha = (word: string): boolean => {
  for (let i = 0; i < word.length; i += 1) {
    const c = word.charCodeAt(i);
    if (c < A || c >= A + ALPHABET) return false;
  }
  return word.length > 0;
};

interface BuildNode {
  children: Map<number, BuildNode>;
  /** Index into the word table if a word terminates here, else -1. */
  wordId: number;
}

const newNode = (): BuildNode => ({ children: new Map(), wordId: -1 });

export class TrieBuilder {
  private readonly root: BuildNode = newNode();
  private nodeCount = 1;

  /** Insert a word and associate it with `wordId`. Word must be lowercase a-z. */
  insert(word: string, wordId: number): void {
    let node = this.root;
    for (let i = 0; i < word.length; i += 1) {
      const letter = word.charCodeAt(i) - A;
      let next = node.children.get(letter);
      if (next === undefined) {
        next = newNode();
        node.children.set(letter, next);
        this.nodeCount += 1;
      }
      node = next;
    }
    node.wordId = wordId;
  }

  /**
   * Flatten to CSR form via an explicit stack (no recursion: word lists are
   * deep enough that a recursive walk risks blowing the stack in a renderer
   * process with a small default limit).
   */
  compile(): CompiledTrie {
    const nodes = this.nodeCount;
    const childStart = new Uint32Array(nodes + 1);
    const childLetter = new Uint8Array(nodes - 1);
    const childNode = new Uint32Array(nodes - 1);
    const wordId = new Int32Array(nodes).fill(-1);

    // Breadth-first assignment gives ascending child indices, which keeps the
    // CSR slices contiguous without a second pass.
    const order: BuildNode[] = [this.root];
    const index = new Map<BuildNode, number>([[this.root, 0]]);
    let cursor = 0;
    let edge = 0;

    while (cursor < order.length) {
      const node = order[cursor] as BuildNode;
      const id = index.get(node) as number;
      wordId[id] = node.wordId;
      childStart[id] = edge;

      const letters = Array.from(node.children.keys()).sort((a, b) => a - b);
      for (const letter of letters) {
        const child = node.children.get(letter) as BuildNode;
        const childId = order.length;
        index.set(child, childId);
        order.push(child);
        childLetter[edge] = letter;
        childNode[edge] = childId;
        edge += 1;
      }
      cursor += 1;
    }
    childStart[nodes] = edge;

    // childStart was written in BFS order, which is also node-id order, so the
    // array is already monotonic. Assert cheaply in development builds.
    return new CompiledTrie(childStart, childLetter, childNode, wordId);
  }
}

export class CompiledTrie {
  constructor(
    private readonly childStart: Uint32Array,
    private readonly childLetter: Uint8Array,
    private readonly childNode: Uint32Array,
    private readonly wordId: Int32Array,
  ) {}

  get nodeCount(): number {
    return this.wordId.length;
  }

  /** Walk one edge. Returns -1 when the letter is absent. */
  private step(node: number, letter: number): number {
    const start = this.childStart[node] as number;
    const end = this.childStart[node + 1] as number;
    // Linear scan: at most 26 entries, contiguous in memory, beats a binary
    // search at this size.
    for (let i = start; i < end; i += 1) {
      if (this.childLetter[i] === letter) return this.childNode[i] as number;
    }
    return -1;
  }

  /** Node reached by consuming `word`, or -1. */
  private descend(word: string): number {
    let node = 0;
    for (let i = 0; i < word.length; i += 1) {
      const letter = word.charCodeAt(i) - A;
      if (letter < 0 || letter >= ALPHABET) return -1;
      node = this.step(node, letter);
      if (node < 0) return -1;
    }
    return node;
  }

  /** Word id if `word` is in the trie, else -1. O(k). */
  lookup(word: string): number {
    const node = this.descend(word);
    return node < 0 ? -1 : (this.wordId[node] as number);
  }

  has(word: string): boolean {
    return this.lookup(word) >= 0;
  }

  /** True when at least one word starts with `prefix`. O(k). */
  hasPrefix(prefix: string): boolean {
    return this.descend(prefix) >= 0;
  }

  /**
   * Word ids under `prefix`, capped at `limit`. Used for typeahead and for
   * bot vocabularies; not on the hot validation path.
   */
  collectPrefix(prefix: string, limit = 50): number[] {
    const start = this.descend(prefix);
    const out: number[] = [];
    if (start < 0) return out;

    const stack = [start];
    while (stack.length > 0 && out.length < limit) {
      const node = stack.pop() as number;
      const id = this.wordId[node] as number;
      if (id >= 0) out.push(id);
      const from = this.childStart[node] as number;
      const to = this.childStart[node + 1] as number;
      for (let i = to - 1; i >= from; i -= 1) stack.push(this.childNode[i] as number);
    }
    return out;
  }

  /** Raw buffers, in the order `fromBuffers` expects. */
  toBuffers(): readonly [Uint32Array, Uint8Array, Uint32Array, Int32Array] {
    return [this.childStart, this.childLetter, this.childNode, this.wordId];
  }

  static fromBuffers(
    childStart: Uint32Array,
    childLetter: Uint8Array,
    childNode: Uint32Array,
    wordId: Int32Array,
  ): CompiledTrie {
    return new CompiledTrie(childStart, childLetter, childNode, wordId);
  }
}
