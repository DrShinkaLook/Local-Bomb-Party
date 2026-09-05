import { readFileSync } from 'node:fs';
import { Dictionary } from '../src/dictionary/dictionary.js';
import type { Clock } from '../src/game/engine.js';

/**
 * The full dictionary is loaded once and shared, because building it costs
 * about a second and the tests that need scale need the real thing — a toy
 * word list would not exercise the n-gram index or the syllable tiering.
 * Tests that mutate used-word state call `resetUsed()` in their own setup.
 */
let shared: Dictionary | null = null;

export const fullDictionary = (): Dictionary => {
  if (shared === null) {
    const path = new URL('../../../data/words-en.txt', import.meta.url);
    shared = Dictionary.fromWordList(readFileSync(path, 'utf8').split('\n'), { minLength: 2 });
  }
  shared.resetUsed();
  return shared;
};

/** A deterministic word list for tests that need exact, hand-checkable counts. */
export const tinyDictionary = (): Dictionary =>
  Dictionary.fromWordList([
    'cat', 'cats', 'catalog', 'concatenate',
    'dog', 'dogma', 'dogged',
    'string', 'strings', 'stringing',
    'ring', 'rings', 'ringing', 'bring', 'brings',
    'test', 'testing', 'tested', 'protest',
    'ate', 'late', 'later', 'plate', 'slate',
  ]);

/** A clock the test drives by hand. No real timers anywhere in the suite. */
export class FakeClock implements Clock {
  private t: number;
  private readonly intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  private nextHandle = 1;

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setInterval(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.intervals.set(handle, { fn, ms, next: this.t + ms });
    return handle;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  /** Advance time, firing any registered intervals in order. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let soonest: { handle: number; entry: { fn: () => void; ms: number; next: number } } | null =
        null;
      for (const [handle, entry] of this.intervals) {
        if (entry.next <= target && (soonest === null || entry.next < soonest.entry.next)) {
          soonest = { handle, entry };
        }
      }
      if (soonest === null) break;
      this.t = soonest.entry.next;
      soonest.entry.next += soonest.entry.ms;
      soonest.entry.fn();
    }
    this.t = target;
  }
}
