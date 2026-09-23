import type { GameRules } from '../types.js';

/**
 * Bomb urgency, derived from authoritative remaining time.
 *
 * The renderer must never disagree with the engine about when the bomb goes
 * off, so this does not touch timing. It takes the linear `progress` the fuse
 * hook already computes from `bombEndsAt` and returns two presentation values:
 *
 *   - `intensity` — 0 before the acceleration threshold, ramping to 1 at
 *     detonation. Drives shake amplitude, shake rate, particle emission and
 *     spark flicker.
 *   - `visualProgress` — where to *draw* the fuse tip. Eased so the fuse
 *     visibly speeds up, while still arriving at exactly 1.0 at exactly the
 *     moment `progress` does.
 *
 * It lives in the engine rather than the desktop app for one reason: a future
 * mobile client must show the same bomb. Keeping the curve here means the
 * shared package owns it and any renderer gets it for free. The function is
 * pure and has no platform dependencies.
 *
 * A note on the easing, because it is a real tradeoff rather than a magic
 * number. Any curve that starts at 0, ends at 1, and covers the same interval
 * has an average slope of 1 — so making the fuse finish faster *requires*
 * making it start slower. `EASE_WEIGHT` sets how much: at the threshold the
 * fuse draws at (1 - w) of the linear rate and at detonation at (1 + 2w).
 * At w = 0.3 that is 0.7x rising to 1.6x, a 2.3x swing that reads clearly as
 * acceleration while the initial dip stays under the perceptual threshold —
 * helped by the shake starting at the same instant and taking the eye.
 */

export interface BombIntensity {
  /** 0..1 urgency. Zero until the acceleration threshold is crossed. */
  readonly intensity: number;
  /** 0..1 fuse position to draw. Equals `progress` when not accelerating. */
  readonly visualProgress: number;
  /** True once acceleration has begun. Presentation cue, not a rule. */
  readonly accelerating: boolean;
}

/** Cubic blend weight. See the note above before changing it. */
const EASE_WEIGHT = 0.3;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

/**
 * @param progress Linear fuse progress, 0 at turn start and 1 at detonation.
 * @param rules    The room's rules; only the two bomb-acceleration fields are read.
 */
export const bombIntensity = (
  progress: number,
  rules: Pick<GameRules, 'bombAccelerationEnabled' | 'bombAccelerationStart'>,
): BombIntensity => {
  const p = clamp01(progress);

  if (!rules.bombAccelerationEnabled) {
    return { intensity: 0, visualProgress: p, accelerating: false };
  }

  // A threshold of 1 or more would make acceleration unreachable; clamping
  // just below keeps the normalisation below well defined.
  const start = Math.min(clamp01(rules.bombAccelerationStart), 0.999);

  if (p <= start) {
    return { intensity: 0, visualProgress: p, accelerating: false };
  }

  // Position within the accelerating tail, renormalised to 0..1.
  const t = (p - start) / (1 - start);

  // Squared so intensity leaves the threshold with zero slope: the shake fades
  // in rather than snapping on, which is what "gradual rather than an instant
  // speed jump" asks for.
  const intensity = t * t;

  // Cubic blend: f(0) = 0, f(1) = 1, slope rises monotonically across the tail.
  const eased = (1 - EASE_WEIGHT) * t + EASE_WEIGHT * t * t * t;
  const visualProgress = start + (1 - start) * eased;

  return { intensity, visualProgress, accelerating: true };
};
