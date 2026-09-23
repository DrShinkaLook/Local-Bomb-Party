import { describe, expect, it } from './harness.js';
import { bombIntensity } from '../src/game/bombIntensity.js';
import { DEFAULT_RULES } from '../src/types.js';

const RULES = { bombAccelerationEnabled: true, bombAccelerationStart: 0.5 };
const OFF = { bombAccelerationEnabled: false, bombAccelerationStart: 0.5 };

describe('GameRules bomb acceleration fields', () => {
  it('ships defaults so existing rooms get the behaviour without opting in', () => {
    expect(DEFAULT_RULES.bombAccelerationEnabled).toBe(true);
    expect(DEFAULT_RULES.bombAccelerationStart).toBe(0.5);
  });

  it('leaves every other default rule untouched', () => {
    expect(DEFAULT_RULES.startingLives).toBe(2);
    expect(DEFAULT_RULES.maxLives).toBe(3);
    expect(DEFAULT_RULES.minBombMs).toBe(5_000);
    expect(DEFAULT_RULES.maxBombMs).toBe(12_000);
    expect(DEFAULT_RULES.alphabetBonusEnabled).toBe(true);
  });
});

describe('bombIntensity', () => {
  it('is inert before the threshold, so early-fuse behaviour is unchanged', () => {
    for (const p of [0, 0.1, 0.25, 0.4, 0.5]) {
      const result = bombIntensity(p, RULES);
      expect(result.intensity).toBe(0);
      expect(result.visualProgress).toBe(p);
      expect(result.accelerating).toBe(false);
    }
  });

  it('is inert entirely when the host disables acceleration', () => {
    for (const p of [0, 0.5, 0.75, 1]) {
      const result = bombIntensity(p, OFF);
      expect(result.intensity).toBe(0);
      expect(result.visualProgress).toBe(p);
      expect(result.accelerating).toBe(false);
    }
  });

  /**
   * The load-bearing assertion. The fuse is eased, so it must still land on
   * exactly 1.0 at exactly the instant the engine detonates the bomb. If this
   * drifts, the UI and the authoritative timer disagree.
   */
  it('lands on exactly 1.0 when the fuse expires', () => {
    expect(bombIntensity(1, RULES).visualProgress).toBe(1);
    expect(bombIntensity(1, OFF).visualProgress).toBe(1);
    expect(bombIntensity(1, { bombAccelerationEnabled: true, bombAccelerationStart: 0.1 }).visualProgress).toBe(1);
    expect(bombIntensity(1, { bombAccelerationEnabled: true, bombAccelerationStart: 0.9 }).visualProgress).toBe(1);
  });

  it('reaches full intensity exactly at detonation', () => {
    expect(bombIntensity(1, RULES).intensity).toBe(1);
  });

  it('is continuous at the threshold rather than jumping', () => {
    const before = bombIntensity(0.5, RULES);
    const after = bombIntensity(0.5001, RULES);
    expect(Math.abs(after.visualProgress - before.visualProgress) < 0.001).toBe(true);
    expect(after.intensity < 0.0001).toBe(true);
  });

  it('keeps both outputs monotonic across the whole fuse', () => {
    let lastVisual = -1;
    let lastIntensity = -1;
    for (let i = 0; i <= 200; i += 1) {
      const { intensity, visualProgress } = bombIntensity(i / 200, RULES);
      expect(visualProgress >= lastVisual).toBe(true);
      expect(intensity >= lastIntensity).toBe(true);
      lastVisual = visualProgress;
      lastIntensity = intensity;
    }
  });

  it('keeps both outputs inside 0..1', () => {
    for (let i = 0; i <= 100; i += 1) {
      const { intensity, visualProgress } = bombIntensity(i / 100, RULES);
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
      expect(visualProgress).toBeGreaterThanOrEqual(0);
      expect(visualProgress).toBeLessThanOrEqual(1);
    }
  });

  /**
   * "Gradual rather than an instant speed jump": the fuse must draw slower
   * than linear just after the threshold and faster than linear at the end.
   */
  it('accelerates the drawn fuse rather than stepping it', () => {
    const rate = (p: number): number => {
      const d = 0.001;
      return (bombIntensity(p + d, RULES).visualProgress - bombIntensity(p, RULES).visualProgress) / d;
    };
    const early = rate(0.55);
    const late = rate(0.99);
    expect(early < 1).toBe(true);
    expect(late > 1.4).toBe(true);
    expect(late > early * 1.8).toBe(true);
  });

  it('honours a custom threshold', () => {
    const late = { bombAccelerationEnabled: true, bombAccelerationStart: 0.8 };
    expect(bombIntensity(0.7, late).accelerating).toBe(false);
    expect(bombIntensity(0.9, late).accelerating).toBe(true);
  });

  it('clamps nonsense input instead of producing NaN', () => {
    expect(bombIntensity(-5, RULES).visualProgress).toBe(0);
    expect(bombIntensity(9, RULES).visualProgress).toBe(1);
    expect(bombIntensity(Number.NaN, RULES).visualProgress).toBe(0);
    expect(bombIntensity(0.99, { bombAccelerationEnabled: true, bombAccelerationStart: 5 }).visualProgress).toBeGreaterThanOrEqual(0);
  });
});
