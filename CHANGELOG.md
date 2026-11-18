# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-11-17

Seven milestones of gameplay, multiplayer and presentation work. Everything
below is on top of a v0.2.1 that was already running; nothing in the existing
rulebook was rewritten.

### Added

- **Bomb acceleration.** Past the halfway point of the fuse the bomb visibly
  speeds up: the shake grows and quickens, the fuse burns faster, the spark
  flickers harder and throws more sparks. All of it is derived from the
  authoritative remaining time by a pure `bombIntensity()` in the engine, so
  the UI cannot disagree with the clock — the drawn fuse is eased but still
  lands on exactly 1.0 at exactly `bombEndsAt`, which is asserted in tests at
  four different thresholds. The tradeoff is stated rather than hidden: a
  curve that finishes faster must start slower, so the fuse draws at 0.71x the
  linear rate just past the threshold and 1.57x at detonation. Host-tunable
  via `bombAccelerationEnabled` and `bombAccelerationStart`.

- **Two new audio cues.** `accelerate`, a rising sweep under a closing filter
  that fires once per turn at the threshold, and `letter`, a soft blip pitched
  by how close the alphabet tracker is to a heart. Both are synthesised in the
  existing `SoundKit` alongside the other six — still no audio files anywhere
  in the bundle. The engine emits no "letter collected" event, so that cue is
  derived by diffing the local player's tracker across snapshots; it is local
  only, because sixteen players' letters would be constant chatter.

- **A music bus for mods.** `playMusic` / `stopMusic` / `setMusicVolume` on a
  separate gain node, so a mod can supply a soundtrack that ducks and mutes
  independently of effects. The core game never calls it — there is still no
  built-in music, by design.

- **A fourth bot tier.** `hard` sits between medium and impossible. Measured
  answer rates across the four tiers are 65.9 / 90.9 / 98.8 / 100 percent with
  mean think times of 4.5s / 2.6s / 1.0s / 5ms. `easy` and `medium` were
  retuned so the steps are visible rather than marginal; `impossible` is
  untouched and pinned by a test. Every profile knob is now asserted monotonic
  across the tiers, which is what stops a later tweak silently making medium
  stronger than hard. The bot search code itself is unchanged.

- **Embedded chat.** A small collapsible panel on the game screen. It lives in
  `GameState` rather than a side channel, so it reaches LAN clients over the
  snapshot path that already exists and a reconnecting player gets the backlog
  from their WELCOME snapshot for nothing. Bounded to 50 messages of 200
  characters, enforced at both the wire and the reducer. Author names are
  snapshotted at send time so a rename cannot rewrite the transcript. The host
  can kick from the transcript. Turn-gating the input is a renderer decision,
  not a rule — chatting on your own turn changes nothing about the game.

- **Lobby readiness, avatars and colours.** Players own their own name,
  avatar, colour and ready state; the host keeps override. Avatars and colours
  are indices into shipped palettes, validated in the reducer, so a LAN peer
  cannot push markup, a URL or a wall of emoji onto anyone else's screen.
  Sixteen avatars for sixteen seats, assigned by seat so a full lobby is
  legible before anyone touches a picker. Readiness is advisory: the renderer
  withholds the Start button, but the engine never refuses the host their own
  room.

- **A seat limit.** `playerLimit` (default 16), enforced on join and on
  `addBot`, and reported by the LAN beacon so the browser shows "3/6" for a
  host who capped it at six. The socket-level cap in `LanHost` stays as a
  backstop.

- **Room codes.** A six-character code joins a room without hunting through
  the browser list. The code is an opaque token carrying no address:
  `IRoomCodeResolver` turns it into an endpoint, and today's LAN
  implementation matches it against UDP beacons hosts already broadcast. A
  relay implementation would replace that one class — code format, protocol,
  UI and engine all stay as they are. The alphabet excludes `0 1 O I L U`, and
  a misread character is dropped rather than guessed, because joining the
  wrong room is a worse failure than being told to retype.

- **Host settings** for player limit, bomb acceleration and chat, all reusing
  the existing `GameRules` and `SET_RULES` rather than a second config system.

### Changed

- **The stage is measured, not assumed.** Bomb size, ring radii, card scale
  and the placement of chat and the alphabet tracker all come from a pure
  `stageLayout(width, height)`. This fixes a real collision: below about
  1100px the chat panel and the right-hand seat of the player ring were
  overlapping. Chat now becomes a bottom sheet at that width, and portrait
  gets a rounder ring rather than a squashed one — the groundwork for a phone
  later, with no change to how the desktop looks.

- **Mobile foundations that cost the desktop nothing.** Touch rules are scoped
  to `@media (pointer: coarse)`, so a finger gets 44px targets while a mouse
  keeps the dense layout. Overscroll, tap delay and the Android tap highlight
  are disabled, safe-area insets are applied to the pinned elements that
  actually sit under a notch, and `prefers-reduced-motion` now damps every
  animation rather than only the shake.

- **Protocol version 2.** Clients may now send `SEND_CHAT`, `SET_READY` and
  `SET_APPEARANCE`, and every discovery beacon must carry a room code. A
  v0.2.x peer is refused at the handshake with a readable reason instead of
  failing on a missing field mid-game.

- `RENAME_PLAYER` moved from host-only to self-owned, so a remote player can
  rename themselves. The host keeps the ability to rename anyone.
- `addBot` returns `PlayerId | null`, returning null when the room is full.
- `MAX_NAME_LENGTH` moved to `types.ts` so the network layer no longer has to
  import from the game layer.

### Fixed

- The single-instance lock is skipped in development. In a packaged build it
  still prevents a second copy, but during `npm run dev` a stray Electron
  process would make the app call `app.quit()` and exit 0 with no window and
  no message — a silent failure that looked like a build problem.

### Testing

- 173 engine tests passing, up from 100. No pre-existing test was broken; one
  beacon fixture was updated for the room-code field it must now carry.
- TypeScript typecheck passing across the engine, the engine tests, the
  renderer and the Electron main process.
- The app has been launched and played: lobby, bots, chat, bomb acceleration
  and the responsive layout were all verified by hand.
- **LAN and room-code joining remain unverified against a second machine.**
  They are covered by unit tests, but no two computers have yet connected to
  each other with this build.

## [0.2.1] — 2026-09-09

### Fixed

- Fixed the Pause and Leave Game controls being visible but unclickable because of a UI stacking issue.
- Fixed the Leave Game flow so the existing session teardown properly stops the game session, timers, bots, and queued bot actions.
- Fixed the gameplay input layout so the word-entry field no longer overlaps the active player's name and hearts.
- Fixed countdown synchronization so gameplay begins immediately when GO appears instead of having an additional delay.
- Verified player elimination and game-ending behavior through additional engine tests.
- Verified the alphabet bonus behavior, including one reward per completed alphabet cycle, tracker reset, repeat rewards, disabled behavior, and the maximum-life cap.

### Testing

- 100 engine tests passing.
- TypeScript typecheck passing.
- Windows packaging was previously verified for the v0.2.0 build; v0.2.1 packaging will be verified separately.

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
  still decides when the first turn begins, so the display cannot disagree
  with the game state.

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