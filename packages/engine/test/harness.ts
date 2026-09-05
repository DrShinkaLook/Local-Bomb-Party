/**
 * A ~100 line test harness.
 *
 * The engine package has zero runtime dependencies, and it is worth keeping the
 * dev dependencies close to zero as well: this suite runs anywhere `tsx` does,
 * with no config file, no globals injected into module scope, and no plugin
 * pipeline between the source and the assertion. Swapping in Vitest later is a
 * mechanical change — `describe`/`it`/`expect` are already the shapes below.
 */

export interface TestCase {
  readonly name: string;
  readonly fn: () => void | Promise<void>;
}

const suites: { name: string; cases: TestCase[] }[] = [];
let current: { name: string; cases: TestCase[] } | null = null;

export const describe = (name: string, body: () => void): void => {
  current = { name, cases: [] };
  suites.push(current);
  body();
  current = null;
};

export const it = (name: string, fn: () => void | Promise<void>): void => {
  if (current === null) throw new Error('it() called outside of describe()');
  current.cases.push({ name, fn });
};

export class AssertionError extends Error {}

const show = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const expect = <T>(actual: T) => ({
  toBe(expected: T): void {
    if (!Object.is(actual, expected)) {
      throw new AssertionError(`expected ${show(expected)}, got ${show(actual)}`);
    }
  },
  toEqual(expected: unknown): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new AssertionError(`expected ${b}, got ${a}`);
  },
  toBeTruthy(): void {
    if (!actual) throw new AssertionError(`expected truthy, got ${show(actual)}`);
  },
  toBeFalsy(): void {
    if (actual) throw new AssertionError(`expected falsy, got ${show(actual)}`);
  },
  toBeGreaterThan(n: number): void {
    if (typeof actual !== 'number' || actual <= n) {
      throw new AssertionError(`expected ${show(actual)} > ${n}`);
    }
  },
  toBeGreaterThanOrEqual(n: number): void {
    if (typeof actual !== 'number' || actual < n) {
      throw new AssertionError(`expected ${show(actual)} >= ${n}`);
    }
  },
  toBeLessThan(n: number): void {
    if (typeof actual !== 'number' || actual >= n) {
      throw new AssertionError(`expected ${show(actual)} < ${n}`);
    }
  },
  toBeLessThanOrEqual(n: number): void {
    if (typeof actual !== 'number' || actual > n) {
      throw new AssertionError(`expected ${show(actual)} <= ${n}`);
    }
  },
  toBeNull(): void {
    if (actual !== null) throw new AssertionError(`expected null, got ${show(actual)}`);
  },
  toContain(needle: string): void {
    if (typeof actual !== 'string' || !actual.includes(needle)) {
      throw new AssertionError(`expected ${show(actual)} to contain ${show(needle)}`);
    }
  },
  toThrow(): void {
    if (typeof actual !== 'function') throw new AssertionError('expected a function');
    try {
      (actual as () => unknown)();
    } catch {
      return;
    }
    throw new AssertionError('expected the function to throw');
  },
});

export const run = async (): Promise<number> => {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const suite of suites) {
    process.stdout.write(`\n  ${suite.name}\n`);
    for (const testCase of suite.cases) {
      const started = Date.now();
      try {
        await testCase.fn();
        passed += 1;
        process.stdout.write(`    ✓ ${testCase.name} (${Date.now() - started}ms)\n`);
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${suite.name} > ${testCase.name}\n      ${message}`);
        process.stdout.write(`    ✗ ${testCase.name}\n      ${message}\n`);
      }
    }
  }

  process.stdout.write(`\n  ${passed} passed, ${failed} failed\n\n`);
  if (failures.length > 0) {
    process.stdout.write('  Failures:\n');
    for (const failure of failures) process.stdout.write(`    - ${failure}\n`);
    process.stdout.write('\n');
  }
  return failed === 0 ? 0 : 1;
};
