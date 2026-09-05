import { describe, expect, it } from './harness.js';
import { Rng } from '../src/util/rng.js';

describe('Rng', () => {
  it('reproduces a sequence from the same seed', () => {
    const a = new Rng('seed');
    const b = new Rng('seed');
    for (let i = 0; i < 500; i += 1) expect(a.next()).toBe(b.next());
  });

  it('diverges for different seeds', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.int(1_000_000))(new Rng('a')));
    const b = Array.from({ length: 20 }, ((r) => () => r.int(1_000_000))(new Rng('b')));
    expect(a.join(',') === b.join(',')).toBe(false);
  });

  it('stays inside its bounds', () => {
    const rng = new Rng(12345);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const r = rng.range(5, 9);
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThanOrEqual(9);
    }
  });

  it('restores an exact saved state', () => {
    const rng = new Rng('restore');
    for (let i = 0; i < 10; i += 1) rng.next();
    const saved = rng.save();
    const expected = Array.from({ length: 10 }, () => rng.next());
    rng.restore(saved);
    expect(Array.from({ length: 10 }, () => rng.next())).toEqual(expected);
  });

  it('produces independent streams per fork label', () => {
    const parent = new Rng('room-seed');
    const a = parent.fork('bot:1');
    const b = parent.fork('bot:2');
    const seqA = Array.from({ length: 10 }, () => a.int(1_000_000)).join(',');
    const seqB = Array.from({ length: 10 }, () => b.int(1_000_000)).join(',');
    expect(seqA === seqB).toBe(false);
  });

  it('honours weights', () => {
    const rng = new Rng('weights');
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i += 1) {
      counts[rng.pickWeighted(['a', 'b'] as const, [9, 1])] += 1;
    }
    // 90/10 split; allow generous slack so this can never flake.
    expect(counts.a / 20_000).toBeGreaterThan(0.85);
    expect(counts.a / 20_000).toBeLessThan(0.95);
  });

  it('rejects degenerate inputs rather than returning undefined', () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.int(0)).toThrow();
  });
});
