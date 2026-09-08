# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-09-08

First version that actually runs. `0.1.0` was written but had never been
compiled against installed dependencies or launched.

### Added

- **Alphabet bonus, now configurable.** The engine already tracked letters and
  paid a life for a full alphabet; the letter set and the payout are now rules.
  `alphabetRequiredLetters` (default all 26) and `alphabetBonusLives`
  (default 1) join the existing `alphabetBonusEnabled`, and a new exported
  `requiredAlphabet()` normalises the set once so the reducer and the renderer
  agree on what "complete" means. The reward is capped by `maxLives` and
  cannot double-pay: the tracker is cleared in the same transition that grants
  it, so no timer, re-render, snapshot or repeated event can trigger it twice.
  Progress is per player, and the local player's progress is drawn down the
  left edge of the game screen straight from the snapshot.
- **Leave Game.** A leave control beside the pause control, with a
  confirmation step. It reuses the existing teardown rather than adding a
  parallel path, so the beacon, host, client, game loop, bots and any queued
  bot action are all torn down.
- **Attribution mark.** "Made by Kobi Dao · © 2026", mounted once in the app
  shell so it appears on every screen; pointer-events-none so it can never
  intercept a click.


- **Pause and resume.** A pause control in the game header, `Esc` as a
  shortcut, and a paused overlay. Implemented as a rule in the engine rather
  than a UI freeze: pausing records the host clock, and resuming pushes every
  deadline in the current phase forward by exactly the paused duration. The
  active player therefore resumes with precisely the fuse they stopped with,
  and `bombEndsAt` stays a genuine absolute deadline so nothing else in the
  codebase needs to know what "paused" means.
- **Editable bot names.** Bot names are click-to-edit in the lobby. The draft
  is local and commits on `Enter` or blur, so a keystroke never becomes an
  intent; `Esc` reverts. Lobby-only, trimmed, capped at 24 characters, and
  blank names are refused rather than producing a nameless seat.
- 12 engine tests covering the above, including that a bot's queued answer is
  shifted by the pause rather than firing the instant play resumes.

### Changed

- Accent colour is now green (`#22c55e`) instead of orange. Added
  `--bp-accent-rgb` so translucent washes derive from a single source. The
  burning fuse and its spark stay warm amber deliberately — a green flame
  reads as a chemistry accident rather than a lit fuse.

### Fixed

- **The start countdown showed "3" for all three seconds.** It computed a value
  once and never re-rendered. It now ticks 3, 2, 1, GO! from the authoritative
  `phase.endsAt`, with a single interval that is cleared when the deadline
  changes or the component unmounts, and it freezes while paused. The engine
  still decides when the first turn begins, so the display cannot disagree with
  the game state.

- **Mods were silently disabled on Windows.** The mod-folder containment check
  compared string prefixes against a root with a trailing `/`. Windows resolves
  paths with backslashes, so every legitimate mod was rejected and the bundled
  `mods/example-mod` never loaded. Now uses `path.relative`, which is correct on
  both separators. The check failed closed, so this was a functional bug rather
  than a traversal hole.
- **The preload script was built as ESM while the window sets `sandbox: true`.**
  Electron requires sandboxed preloads to be CommonJS, so the bridge failed to
  load, `window.bombParty` was undefined, and the app rendered a black screen.
  The preload is now bundled to `preload.cjs`. Fixed without weakening the
  sandbox, which is a stated non-negotiable of the security posture.
- **The engine's package entry points pointed at a path that never existed.**
  `main`/`types` referenced `dist/src/index.js`, but `rootDir: "src"` strips the
  prefix and the build emits `dist/index.js`. This broke the desktop typecheck
  and would have broken the packaged app at runtime.
- Engine is now built before the desktop workspace in `dev` and `typecheck`;
  neither previously did so, and both failed on a clean checkout.
- `REJECTION_TEXT` is typed `Record<ValidationFailure, string>` instead of
  `Record<string, string>`, so a new failure reason fails compilation until its
  UI text exists.
- Closing the game window reports success instead of an npm error wall
  (`concurrently --success first`).

## [0.1.0] — 2026-09-05

Initial clean-room implementation: deterministic engine, dictionary with a CSR
trie and n-gram index, weighted syllable generator, offline bots, LAN transport
with UDP discovery, Electron shell and React render view.
