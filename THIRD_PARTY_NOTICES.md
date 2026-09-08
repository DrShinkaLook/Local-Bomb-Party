# Third-party notices

Bomb Party is proprietary software — Copyright © 2026 Kobi Dao, All Rights
Reserved (see `LICENSE.txt`). It incorporates the third-party components
below, which are **not** covered by that proprietary licence and remain
governed solely by their own terms.

Every one is permissively licensed and redistributable, and none imposes a
copyleft obligation that would require this project's own source to be
published. That is what makes a proprietary application on top of them
lawful.

This file must ship with any binary release.

---

## Components that ship inside a packaged build

### Electron — MIT

<https://github.com/electron/electron>

Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Electron embeds the following, which are redistributed with it:

- **Chromium** — BSD 3-Clause and others.
  Copyright (c) The Chromium Authors.
  Full notices ship inside the Electron distribution as `LICENSES.chromium.html`
  and are included automatically by electron-builder.
- **Node.js** — MIT. Copyright (c) Node.js contributors.
- **V8** — BSD 3-Clause. Copyright (c) 2006-2011, the V8 project authors.

### React and React DOM — MIT

<https://github.com/facebook/react>

Copyright (c) Meta Platforms, Inc. and affiliates.

Bundled into the renderer by Vite.

### ws — MIT

<https://github.com/websockets/ws>

Copyright (c) 2011 Einar Otto Stangvik, and contributors.

Used by the main process for LAN play.

---

## Data

### SCOWL (Spell Checker Oriented Word Lists)

`data/words-en.txt` is derived by affix expansion from the SCOWL en_US
Hunspell dictionary.

Copyright 2000-2011 by Kevin Atkinson.

> Permission to use, copy, modify, distribute and sell these word lists, the
> associated scripts, the output created from the scripts, and its
> documentation for any purpose is hereby granted without fee, provided that
> the above copyright notice appears in all copies and that both that
> copyright notice and this permission notice appear in supporting
> documentation. Kevin Atkinson makes no representations about the suitability
> of this array for any purpose. It is provided "as is" without express or
> implied warranty.

Alan Beale is credited by the upstream project for the 12Dicts package and for
contributions to the ENABLE word list.

The full upstream notice is reproduced verbatim in
`data/LICENSE-DICTIONARY.txt`, which satisfies the attribution requirement and
must also ship with any release.

---

## Build-time only — not redistributed

These are development dependencies. They do not form part of a packaged build
and create no distribution obligation. Listed for completeness.

| Package | Licence |
|---|---|
| TypeScript | Apache-2.0 |
| Vite | MIT |
| esbuild | MIT |
| Tailwind CSS | MIT |
| PostCSS, Autoprefixer | MIT |
| electron-builder | MIT |
| concurrently | MIT |
| tsx | MIT |

---

## Assets

There are none. The project contains **no** bundled images, icons, fonts,
audio files, video, or other binary media. All sound is synthesised at runtime
from oscillators and shaped noise (`apps/desktop/src/audio/sfx.ts`), and the
bomb is drawn procedurally to a canvas. Nothing was sourced from a third party,
so no asset licence applies.
