/**
 * Deterministic pseudo-random number generation.
 *
 * The engine is host-authoritative and must be reproducible: given the same
 * seed and the same ordered sequence of intents, every host must arrive at an
 * identical state. `Math.random` cannot provide that, so all randomness in the
 * engine flows through this module.
 *
 * Algorithm: SplitMix64-style 32-bit variant (mulberry32). Chosen for being
 * tiny, allocation-free, and passing enough of the small-crush battery for a
 * party game. It is *not* cryptographically secure and must never be used for
 * anything security-bearing.
 */

/** An opaque, serialisable RNG state. Copyable for snapshot/rollback. */
export interface RngState {
  readonly s: number;
}

export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === 'string' ? Rng.hashSeed(seed) : seed >>> 0;
  }

  /** FNV-1a over the seed string, so human-readable seeds are usable. */
  static hashSeed(seed: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new RangeError('maxExclusive must be > 0');
    return Math.floor(this.next() * maxExclusive);
  }

  /** Uniform integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    if (max < min) throw new RangeError('max must be >= min');
    return min + this.int(max - min + 1);
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty array');
    return items[this.int(items.length)] as T;
  }

  /**
   * Weighted pick. `weights[i]` is the relative likelihood of `items[i]`.
   * Weights need not sum to one; non-positive weights are treated as zero.
   */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty array');
    if (items.length !== weights.length) {
      throw new RangeError('items and weights must be the same length');
    }
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return this.pick(items);

    let roll = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      const w = weights[i]! > 0 ? weights[i]! : 0;
      roll -= w;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Snapshot the generator so a state sync can restore it exactly. */
  save(): RngState {
    return { s: this.s };
  }

  restore(state: RngState): void {
    this.s = state.s >>> 0;
  }

  /** An independent generator derived from this one (for per-bot streams). */
  fork(label: string): Rng {
    return new Rng((this.s ^ Rng.hashSeed(label)) >>> 0);
  }
}
