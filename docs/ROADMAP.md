# Roadmap

Ordered by what unblocks the most, not by what is most fun.

## 1. Verify the desktop app end to end

The engine is tested and typechecked. The Electron and React layers have been
syntax-checked but never compiled against real `@types/react`, `@types/node` or
Electron, and never launched — the environment they were written in had no npm
access. First job on a machine with dependencies:

```bash
npm install
npm run typecheck     # expect a handful of import/type fixes here
npm test              # 66 engine tests, should pass unchanged
npm run dev
```

Treat the first `typecheck` as a task, not a smoke test.

## 2. Component tests for the render view

The engine is covered; React is not. Vitest plus Testing Library, asserting that
a given snapshot renders the right seat as active, the input is disabled off-turn,
and the fuse bar tracks `bombEndsAt`.

## 3. A real frequency table

Bot vocabulary tiering currently uses word length as a commonness proxy. It is
defensible and documented as an approximation, but a genuine frequency list
(SUBTLEX-US, or a corpus count with a compatible licence) would make easy bots
feel like beginners rather than like players who only know short words.

## 4. LAN soak testing

Two machines, a deliberately bad connection, and a laptop lid closed mid-round.
The reconnection path replays the player id to reclaim a seat; that logic has
unit coverage for the reducer but has never met a real dropped socket.

## 5. Match history (SQLite)

Settings live in a JSON file, which is right for a handful of preferences. Match
history — per-player word counts, longest words, win rates over time — wants
queries. `better-sqlite3` behind the same storage seam in `settings.ts`.

## 6. Spectators and late join

The reducer already keeps a seat for a disconnected player and reseats densely in
the lobby. A spectator role (receives snapshots, cannot submit) is a small
addition to `PlayerKind` and the authorisation switch.

## 7. Internet play

`INetworkAdapter` was built for this. A relay adapter plus a small rendezvous
service is the remaining work; the game above the interface does not change.
Anti-cheat gets easier, not harder, because the host is already authoritative —
a client that submits a word it could not have known is already rejected.

## 8. Accessibility pass

Reduced-motion and screen-shake toggles exist and are honoured. Still to do:
full keyboard navigation of the lobby, focus management on phase changes, an
`aria-live` region announcing the current syllable and whose turn it is, and a
contrast audit of the ember-on-indigo palette.

## 9. Rename before any public release

See `docs/CLEAN-ROOM.md`. The code is clean-room; the working title is not
distinctive. Three files to change.
