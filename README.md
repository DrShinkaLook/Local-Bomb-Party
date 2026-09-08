# Bomb Party

A desktop word-bomb party game. Type a word containing the syllable before the
fuse burns out; miss, and it costs you a life. Last player standing wins.

Electron + React + TypeScript, with a headless deterministic game engine that
knows nothing about either.

## Disclaimer

This is an independent, unofficial software project created by Kobi Dao for
educational and portfolio purposes. It is not affiliated with, endorsed by, or
sponsored by JKLM or any other third party. All original source code and
original project materials in this repository are © 2026 Kobi Dao. Third-party
names and trademarks remain the property of their respective owners.

```bash
npm install
npm test        # 78 engine tests
npm run dev     # launches the app
```

## What is interesting about it

**The engine is a pure function.** `reduce(state, command, ctx)` is the entire
rulebook. It has no clock, no sockets, and no renderer, and it compiles against
`lib: ["ES2022"]` with `"types": []` so the compiler enforces that. React is a
render view over snapshots; it holds no game logic at all.

**Single-player is a LAN game with a loopback transport.** Both go through
`INetworkAdapter`, both pass the same authorisation checks. There is no separate
offline code path to drift out of sync with the real one.

**The dictionary answers "is this syllable still possible?" in O(1).** Every 2-
and 3-gram carries a live count of unused words containing it, decremented as
words are played. That is what makes the never-issue-an-unwinnable-prompt
guarantee affordable rather than aspirational.

**Syllable pools are derived, not hardcoded.** Coverage and onset frequency are
measured against whatever dictionary is loaded, so a themed mod list reshapes the
pools with no configuration — and grams that read as noise (`rp`, `hs`, `bst`)
are filtered out by rule rather than by blocklist.

**Everything is seeded.** Same seed, same game — bots included. That is what
makes "impossible bots beat easy bots" a deterministic assertion rather than a
flaky one.

**All audio is synthesised at runtime.** Oscillators and shaped noise, no sample
files. The fuse tick takes the remaining fraction as a parameter and rises
continuously, which a recorded sample cannot do.

## Measured

| | |
|---|---|
| Dictionary | 128,016 words · 314,201 trie nodes · 8,523 indexed grams |
| Membership lookup | ~100ns (1M lookups in 98ms) |
| `findWordsContaining("ing")` | 10,103 words in 2ms |
| Feasibility count | O(1) — 10,000 queries in 2ms |
| Cold build from text | ~1,030ms (in a worker thread) |
| Restore from binary table | ~40ms |
| Impossible bot decision | <10ms |

## Layout

```
packages/engine/     headless game engine, zero runtime dependencies
apps/desktop/        Electron main process + React renderer
data/                word list and its licence
tools/               dictionary build and fetch scripts
mods/                drop-in word lists, syllables, themes, audio
docs/                architecture, clean-room policy, roadmap
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the design and why each piece
  is shaped the way it is
- [`docs/CLEAN-ROOM.md`](docs/CLEAN-ROOM.md) — what is original here and what
  was deliberately not done
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is not finished, honestly
- [`mods/README.md`](mods/README.md) — writing a mod

## Word list

`data/words-en.txt` is expanded from the SCOWL en_US Hunspell dictionary
(Kevin Atkinson), which is permissively licensed; the notice is reproduced in
`data/LICENSE-DICTIONARY.txt`. To swap in a larger public-domain list:

```bash
npm run dictionary:fetch -- --source enable   # ~170k words
npm run dictionary:fetch -- --source dwyl     # ~370k words
```

## Status

Playable. The engine is complete, strictly typed, and covered by 78 passing
tests; the Electron and React layers compile clean under `npm run typecheck`
and the app has been launched and played on Windows.

Verified: the main menu, dictionary load (128,016 words), LAN discovery scan,
settings, the green theme, and the full engine rule set including pause.

Not yet verified: LAN play between two physical machines, and the render view
has no component tests of its own. See `docs/ROADMAP.md`.
