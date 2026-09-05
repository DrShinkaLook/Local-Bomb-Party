# Clean-room policy

This project recreates a word-bomb party game. That genre is not owned by
anyone — "type a word containing a given substring before a timer expires" is a
mechanic, and mechanics are not protectable. What *is* protectable is the
expression: another project's code, art, audio, word data, syllable tables,
copy, and branding.

The line this project holds:

## What is original here

- **All code.** Every line in `packages/` and `apps/` was written for this
  repository. No third-party game client was read, decompiled, or ported.
- **All audio.** Every sound is synthesised at runtime from oscillators and
  shaped noise (`apps/desktop/src/audio/sfx.ts`). There are no audio files in
  the bundle, so there is no sample that could have come from somewhere.
- **All visual design.** The bomb is drawn with Canvas 2D primitives; the
  palette, layout, and type scale are this project's own.
- **The syllable pools.** They are *derived at load time* from whatever
  dictionary is loaded, by measuring word coverage and onset frequency. They are
  not a copied list. Swap the word list and the pools change with it.
- **The wire protocol.** Designed here (`packages/engine/src/net/protocol.ts`),
  not observed from anyone's traffic.

## The word list

`data/words-en.txt` is expanded from the **SCOWL** en_US Hunspell dictionary by
Kevin Atkinson, which grants permission to "use, copy, modify, distribute and
sell these word lists ... and the output created from the scripts" provided the
copyright notice is preserved. It is reproduced in full in
`data/LICENSE-DICTIONARY.txt`.

`tools/fetch-dictionary.mjs` can substitute a larger list; the sources it offers
are public domain (ENABLE) or Unlicense (dwyl/english-words). It will not fetch
word data from a game service.

## What was deliberately not done

- No word list, syllable pool, difficulty table, or asset was taken from any
  existing online implementation of this genre.
- No third-party client library for such a service was read, ported, or used as
  a protocol reference. Reimplementing another product's wire format from a
  client library is the opposite of clean-room work, and it would also make the
  networking here a derivative of theirs rather than a design of its own.
- Nothing in this project connects to a third-party game service, and nothing in
  it automates play against one.

## Branding

The working title is a plain description of the mechanic and is shared with at
least one existing product's game mode. That is a naming risk, not a code risk:
if this is ever distributed publicly rather than kept as a portfolio piece, the
title should change. The build is arranged so that it can — the package names,
Electron `appId` (`dev.bombparty.desktop`), and window title are set in three
places (`apps/desktop/package.json`, `electron/main.ts`, `index.html`), and
nothing else in the codebase encodes the product name.
