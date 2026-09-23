/**
 * Where everything sits on the play surface, as a pure function of the space
 * available.
 *
 * Before this, the stage was built from constants: a 320px bomb, a 260px ring
 * radius, a chat panel pinned 16px from the right. That works at exactly one
 * window size and silently overlaps at others — the ring's right-hand seat and
 * the chat panel were on a collision course below about 1100px.
 *
 * Deriving the geometry instead of hard-coding it is also the piece that makes
 * a phone possible later. A portrait screen is not a small desktop: the ring
 * wants to be rounder, the bomb smaller, the chat a sheet rather than a
 * floating panel. Those are all decisions about *shape*, and they belong in one
 * pure function that a future React Native client can call with its own
 * dimensions rather than re-derive by eye.
 *
 * Deliberately not in `packages/engine`: this is presentation, and the engine
 * stays free of anything that assumes a screen. If a second client ever needs
 * it, this file is the thing to lift into a shared `packages/ui-core`.
 */

export type StageMode = 'compact' | 'standard' | 'wide';
export type ChatPlacement = 'docked' | 'sheet';
export type AlphabetPlacement = 'rail' | 'strip';

export interface StageLayout {
  readonly mode: StageMode;
  readonly portrait: boolean;
  /** Square canvas edge for the bomb, in CSS pixels. */
  readonly bombSize: number;
  /** Horizontal and vertical radii of the player ellipse. */
  readonly ringRadiusX: number;
  readonly ringRadiusY: number;
  /** Multiplier applied to player cards so a full ring still fits. */
  readonly cardScale: number;
  readonly chat: ChatPlacement;
  readonly alphabet: AlphabetPlacement;
}

/** Unscaled player-card footprint, matching the card's own Tailwind sizing. */
const CARD_WIDTH = 160;
const CARD_HEIGHT = 96;

/** Room kept clear at the top for the header and at the bottom for the input. */
const TOP_RESERVE = 72;
const BOTTOM_RESERVE = 132;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const stageLayout = (width: number, height: number): StageLayout => {
  // A zero-sized container happens for one frame before the first measurement;
  // returning sane numbers avoids a visible pop.
  const w = width > 0 ? width : 1_280;
  const h = height > 0 ? height : 800;

  const portrait = h > w;
  const mode: StageMode = w < 720 ? 'compact' : w < 1_100 ? 'standard' : 'wide';

  const cardScale = mode === 'compact' ? 0.76 : mode === 'standard' ? 0.88 : 1;
  const cardW = CARD_WIDTH * cardScale;
  const cardH = CARD_HEIGHT * cardScale;
  const gutter = mode === 'compact' ? 10 : 20;

  // The bomb takes a share of the smaller dimension so it never crowds a short
  // window, and is capped so it does not become a billboard on a large one.
  const bombSize = Math.round(clamp(Math.min(w, h) * 0.34, 168, 340));

  // Ring radii are whatever is left once a card and the gutter are subtracted,
  // which is what actually keeps the outermost seat on screen.
  const ringRadiusX = Math.round(clamp(w / 2 - cardW / 2 - gutter, 104, 320));

  const verticalRoom = h / 2 - cardH / 2 - Math.max(TOP_RESERVE, BOTTOM_RESERVE) / 2;
  // Landscape keeps the flat ellipse the game already has; portrait opens it
  // up, because a tall screen has height to spend and no width to spare.
  const preferredY = portrait ? ringRadiusX * 1.15 : ringRadiusX * 0.62;
  const ringRadiusY = Math.round(clamp(Math.min(preferredY, verticalRoom), 64, 340));

  return {
    mode,
    portrait,
    bombSize,
    ringRadiusX,
    ringRadiusY,
    cardScale,
    // A floating panel only has somewhere to float when the ring is not
    // already using that corner.
    chat: mode === 'wide' && !portrait ? 'docked' : 'sheet',
    alphabet: mode === 'compact' || portrait ? 'strip' : 'rail',
  };
};
