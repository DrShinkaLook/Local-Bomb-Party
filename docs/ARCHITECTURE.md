# Architecture

## The one idea

**The game is a pure function; everything else is a driver.**

`reduce(state, command, ctx) -> { state, events }` is the only thing that can
change a game. It has no clock, no sockets, no React, no Electron. Around it sit
three drivers that supply what a pure function cannot have: `GameEngine` (a
clock and scheduled bot moves), an `INetworkAdapter` (bytes), and React (pixels).

Everything below follows from that split.

```
                    ┌─────────────────────────────────────────┐
                    │            Electron main                │
                    │                                         │
  LAN clients ─ws──▶│  LanHost ──▶ GameEngine ──▶ reduce()    │
                    │                  │            ▲         │
                    │                  │            │         │
                    │             Dictionary   SyllableGen    │
                    │             (worker-built binary table) │
                    └──────────────────┬──────────────────────┘
                                       │ IPC (preload allow-list)
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │        Renderer (sandboxed)             │
                    │  React ── useSession ── snapshot only   │
                    └─────────────────────────────────────────┘
```

## Package layout

```
packages/engine/          zero runtime dependencies, lib: ["ES2022"] only
  src/util/rng.ts         seeded, forkable, save/restore
  src/dictionary/         trie, n-gram index, binary format, syllable pools
  src/game/machine.ts     the reducer — the whole rulebook
  src/game/engine.ts      host driver: clock, listeners, bot scheduling
  src/bots/               offline deterministic opponents
  src/net/                protocol, INetworkAdapter, LocalAdapter

apps/desktop/
  electron/               main process: engine host, sockets, files
  electron/preload.ts     the only bridge; a closed set of functions
  src/                    React render view
```

The engine compiles against `lib: ["ES2022"]` with `"types": []`. That is not a
stylistic choice — it is the compiler enforcing "the engine does not depend on
its host". When `systemClock` needed `setInterval`, the compiler refused, and
the fix was a five-line structural interface rather than pulling in a platform
lib. The constraint pays for itself the first time you want to run the engine
somewhere new.

## Host authority

Only the host holds a `GameState`. Everyone else — including the player sitting
at the host machine — sends `Intent`s and receives `GameEvent`s.

Authorisation happens twice, deliberately:

1. **At the wire** (`protocol.ts`): `isValidIntent` accepts only the four
   intents a remote client may express. `START_GAME`, `SET_RULES`, `ADD_BOT`
   and `REMOVE_PLAYER` are rejected before they are even parsed into an intent.
2. **At the engine** (`GameEngine.dispatch`): an intent naming a player other
   than the authenticated sender is refused, and privileged intents require the
   host origin (`null`).

The second check costs a switch statement, so there is no reason not to have it.

The local player goes through `LocalAdapter`, which passes its own player id as
the origin. Single-player therefore exercises the same authorisation path as a
LAN client — a bug that let one client act as another would fail a
single-player test, not wait for someone to try it over a network.

## Time and the fuse

The host sends an absolute `bombEndsAt`, once, at turn start. It does not stream
a countdown.

The renderer interpolates against `requestAnimationFrame` and a loosely averaged
clock-skew estimate (`useFuse`). So the bar is smooth at 60fps while the network
carries a handful of messages per turn, and clock skew between machines shifts
the bar rather than changing who explodes — the host alone decides that, from
its own clock.

`BOMB_TICK` exists for local audio and haptics and is throttled to ~10Hz. The
LAN host does not forward it; sending ten messages a second to every peer to
communicate something they can already derive would be pure waste.

### Pausing

Pause is a rule, not a UI freeze, so it lives in the reducer with everything
else that can change the outcome of a round.

`GameState.pausedAt` holds the host clock at which the game stopped, or null.
`tick` returns early while it is set, which freezes the countdown, the fuse and
the post-explosion pause together — all three are `now` comparisons, so one
guard covers them. Resuming pushes every deadline in the current phase forward
by exactly the paused duration.

That last part is the whole design. The alternative — storing "milliseconds
remaining" and recomputing on resume — would make `bombEndsAt` conditional, and
every consumer of it (the renderer's interpolation, the LAN snapshot, the bot
scheduler) would need to learn what "paused" means. Shifting the deadline
instead keeps it an absolute timestamp in every phase, and the active player
resumes with precisely the fuse they stopped with.

One thing the reducer cannot own: a bot's queued submission is scheduled in
`GameEngine` as an absolute timestamp on the same clock, so it is shifted by the
same amount there. Without that, every bot would answer the instant play
resumed, having apparently "thought" for the length of the pause. There is a
test for exactly this.

Pause is host-authority, like starting the game: it is refused at the wire for
remote clients and again in `GameEngine.dispatch`.

## The dictionary

Three structures over one word table:

| Structure | Purpose | Cost |
|---|---|---|
| CSR trie | membership, prefixes | O(k), ~100ns/lookup measured |
| 2/3-gram inverted index | `findWordsContaining` | one hash probe |
| availability counters | "can this syllable still be answered?" | O(1) |

The trie is stored as compressed sparse rows: children of node `n` live in
`[childStart[n], childStart[n+1])` of parallel `childLetter`/`childNode` arrays.
Contiguous, no per-node objects, and it serialises to bytes with nothing to
parse on the way back in.

**Availability counters are the interesting part.** Asking "how many unused
words contain ING?" naively costs a scan of the posting list. The syllable
generator asks that question of dozens of candidates per draw, so instead each
gram carries a live count that is decremented when a word is consumed — O(word
length) per play, O(1) per query. That is what makes the "never issue an
impossible syllable" guarantee affordable rather than aspirational.

### Binary format

Building from text costs ~1s. Doing it at every launch is a second of empty
window, so it is done once and written as `dictionary-v1.bin`: a header plus
length-prefixed typed-array sections. Loading is `new Uint32Array(buffer,
offset, length)` per section — views over bytes already in memory. Measured:
~40ms restore versus ~1030ms rebuild.

The build runs in a `worker_thread`, and the buffer is *transferred* rather than
copied, so a 20MB table crosses the thread boundary as a pointer hand-off.

## Syllable generation

Pools are **derived from the loaded dictionary**, never hardcoded. Every 2- and
3-gram is scored by word coverage, and the feasible ones are cut into tiers by
quantile — quantiles rather than absolute counts, so the tiers hold for a 5k-word
mod list and a 300k-word dictionary alike.

Coverage alone turned out to be a bad admissibility test. `rp`, `hs` and `bst`
each occur in thousands of words, but only across syllable boundaries
("sharply", "months", "substance"); shown `RP`, a player has to reverse-engineer
the split rather than think of a word. So a gram is admitted if it carries a
vowel, or if enough words *begin* with it — which keeps `st`, `ch`, `thr`, `spl`
and drops the scanning artefacts. Both thresholds are measured against the
loaded dictionary, so a themed mod gets its own answer.

Draws are rejection-sampled against the live availability counter, then against
a short repeat history, with progressive fallback rather than an exception.

## Bots

Deterministic, offline, no model inference. A bot is asked "what would you do
with this syllable?" and answers with a word and a delay; the host schedules the
submission on its own clock, so bot decisions live inside the authoritative
simulation and replay from a seed.

Each bot gets its own RNG stream (`Rng.fork(id)`), so adding or removing one bot
does not reshuffle every other bot's decisions.

Vocabulary tiering uses a stable hash of the word id rather than the id itself.
Ids are assigned in sorted order, so using them directly would give every bot the
same alphabetical bias — every easy bot would know `aardvark` and none would know
`zebra`.

| Tier | Vocabulary | Think time | Miss chance |
|---|---|---|---|
| easy | 6% | 2–5s | 22% |
| medium | 35% | 1–3s | 6% |
| impossible | 100% | 0–10ms | 0% |

The honest caveat: word length is a *proxy* for commonness, not a frequency
table. A real frequency corpus with a compatible licence is the obvious upgrade
and is on the roadmap.

## Network layer

`INetworkAdapter` is the seam. Three implementations, one interface:

- `LocalAdapter` — in-process, latency 0.
- `LanClientAdapter` — `ws`, with ping/pong latency measurement and exponential
  backoff reconnection that replays the original player id to reclaim a seat.
- (planned) a relay adapter for internet play.

Discovery is separate from `INetworkAdapter`, because discovery is a concern of
the lobby browser rather than a connected session: hosts broadcast a small JSON
beacon over UDP once a second, clients time hosts out after four.

Abuse handling on the host is per-connection, not global — 4KB max frame, 40
messages/second, 16 clients — so one misbehaving peer cannot starve the room.

## Electron security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `ipcRenderer` is never exposed. The preload publishes a closed set of
  functions, none of which takes a channel name from the caller.
- Navigation and window-open are refused outright.
- A strict CSP in `index.html` on top of all of that.

The renderer is treated as untrusted. Not out of paranoia about our own code —
it is what makes a bug in rendering a LAN-supplied display name a *rendering
bug* rather than remote code execution.

## Mods

Data only. There is no plugin entry point, so a downloaded mod cannot execute
anything, and every path is checked to be inside the mods root before it is
read. Custom syllables are feasibility-checked against the loaded dictionary and
silently dropped if the word list cannot satisfy them, rather than handed to a
player as an unwinnable turn.

## Testing

66 tests, no test framework — a ~100-line harness (`test/harness.ts`), because
the engine has zero runtime dependencies and it is worth keeping the dev
dependencies near zero too. `describe`/`it`/`expect` already have the shapes
Vitest uses, so swapping later is mechanical.

Time is never real in tests: `FakeClock` is driven by hand, so a full 2-minute
game runs in 200ms and cannot flake on a slow machine.

What is actually asserted, beyond the obvious:

- **Determinism** — the same seed replays an identical event log; different
  seeds do not.
- **Feasibility** — 1,200 syllable draws across all three tiers, each checked to
  have answerable words, including as the word pool drains.
- **Well-formedness** — `rp` and `hs` are absent from the pools; `st` is present.
- **Authorisation** — impersonation and privileged intents are refused, on both
  the local and the wire path.
- **Protocol hardening** — malformed JSON, version mismatch, oversized strings,
  privileged intents from the wire.
- **Bot skill ordering** — impossible beats easy in ≥75% of 12 seeded matches.
- **Binary round-trip** — identical query results, and an order of magnitude
  faster than a rebuild.

## What is not done yet

See `docs/ROADMAP.md`.
