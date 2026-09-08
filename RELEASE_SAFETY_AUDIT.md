# Release safety audit

**Project:** Bomb Party — desktop word-bomb game (Electron + React + TypeScript)
**Owner:** Kobi Dao
**Audit date:** 7 September 2026
**Audited commit:** `3662937` plus the hardening changes recorded here
**Verdict:** **Safe to release once the two open decisions below are made.**
No blocking legal, security, or privacy defect was found.

---

## Open decisions (owner action required)

| # | Decision | Risk if ignored | Status |
|---|---|---|---|
| 1 | Licensing model | An earlier pass wrongly applied the MIT Licence to the owner's original code | **Resolved** — corrected to proprietary before any publication. See Licensing model. |
| 2 | The product name "Bomb Party" | Shared with JKLM.fun's game mode. Naming/trademark exposure, and it makes original work look derivative | **OPEN** — see Trademark |
| 3 | Set the real `repository` URL in `package.json` | Currently a placeholder `OWNER` | **OPEN** — one-line edit once the GitHub repo exists |
| 4 | Application icon | Packaged builds use the default Electron icon | **OPEN** — cosmetic, not a blocker |

Everything else below is either clean or already fixed.

---

## Ownership

Owned solely by Kobi Dao; no third-party claim identified.

**PROPRIETARY ORIGINAL SOFTWARE — Copyright © 2026 Kobi Dao. All Rights
Reserved.** Third-party dependencies are licensed separately under their own
respective licences and are unaffected by that claim.

Registration status: **NOT REGISTERED / REGISTRATION NOT YET VERIFIED.**

Full statement, including the employment/coursework caveat, in `COPYRIGHT.md`.

### Licensing model — corrected

An earlier release pass applied the **MIT Licence** to the owner's original
code. That was **not** the intended model and has been corrected: the original
game code and content are proprietary, all rights reserved.

The correction was made **before any publication**. The repository has never
been pushed, shared, or distributed — verified: no git remote has ever been
configured and no remote-tracking refs exist — and the commit that introduced
the MIT licence was amended in place, so no public history will contain it.

This does not affect the dependencies. A proprietary application may lawfully
depend on permissively licensed open-source libraries, which is exactly the
arrangement here: none of the components in `THIRD_PARTY_NOTICES.md` carries
a copyleft obligation that would require publishing this project's source.

## AI provenance

Disclosed. Parts of the codebase were written with AI assistance under the
owner's direction; AI-assisted commits carry a `Co-Authored-By` trailer.

This has one real consequence: **AI-generated material must be disclosed and
disclaimed if the work is registered with the US Copyright Office**, and the
claim limited to human authorship. Registration preparation is in
`COPYRIGHT.md`. LAWYER REVIEW RECOMMENDED before filing.

## Asset provenance

**No risk. There are no third-party assets.**

A full inventory of tracked files returns zero binary or media files — no
`.png`, `.jpg`, `.svg`, `.ico`, `.ttf`, `.woff`, `.mp3`, `.wav`, `.ogg`,
`.mp4`, or any other media:

- All audio is **synthesised at runtime** from oscillators and shaped noise
  (`apps/desktop/src/audio/sfx.ts`). No sample files exist.
- The bomb, fuse, spark, and particles are **drawn procedurally** to a canvas.
- Typography declares "Space Grotesk" and "Inter" but bundles neither and
  fetches neither, so both fall back to the system UI font. This is cosmetic
  only, and it is the reason the app makes **no font-CDN request** — a privacy
  benefit. See Known cosmetic issues.

The only third-party *data* is the SCOWL word list, which is permissively
licensed with an attribution requirement that is satisfied.

## Dependencies and licences

Every component that ships in a packaged build is permissively licensed. No
copyleft obligation attaches to this project.

| Ships to users | Licence |
|---|---|
| Electron (embeds Chromium, Node.js, V8) | MIT (Chromium BSD-3-Clause, V8 BSD-3-Clause) |
| React, React DOM | MIT |
| ws | MIT |
| SCOWL word list (data) | Permissive, attribution required — satisfied |

Build-time only, not redistributed: TypeScript (Apache-2.0); Vite, esbuild,
Tailwind, PostCSS, Autoprefixer, electron-builder, concurrently, tsx (all MIT).

Full text and attributions: `THIRD_PARTY_NOTICES.md`. **This file must ship
with any binary release**, alongside `LICENSE.txt` and
`data/LICENSE-DICTIONARY.txt`.

### The npm audit warning is a false alarm

`npm install` reports *"16 vulnerabilities (1 critical, 14 high)"*. Verified:

```
npm audit --omit=dev   ->   found 0 vulnerabilities
```

All sixteen are in the `electron-builder` → `@electron/rebuild` → `node-gyp` /
`tar` / `cacache` build chain. **None ships in the product.** Clearing them
requires a breaking upgrade to electron-builder 26; it is optional and can be
scheduled rather than rushed. Not a release blocker.

## Copyright

See `COPYRIGHT.md`. Clean-room status is documented and was actively defended
during development: a third-party Python client for JKLM.fun was explicitly
refused as a reference to avoid contaminating the protocol and word data.

Game *mechanics* are not copyrightable, so reimplementing the format is lawful.
The exposure is the name, not the code.

## Trademark checklist — **OPEN**

"Bomb Party" is descriptive and shared with JKLM.fun's game mode. Before any
public release under this name:

- [ ] Decide whether to keep the name at all. A distinctive name is a stronger
      portfolio asset and removes the whole question.
- [ ] Search the relevant trademark register (USPTO TESS in the US) for the
      chosen name in the software/games classes.
- [ ] Plain search for existing games and storefront listings using it.
- [ ] Check domain and storefront handle availability if that matters.
- [ ] Confirm no logo, wordmark, colour scheme, or UI layout resembles
      JKLM.fun's. *(Assessed here: the interface is an independent design. No
      similarity found.)*

Renaming is a **three-file change**: `apps/desktop/package.json`
(`productName`), `apps/desktop/electron/main.ts` (window title), and
`apps/desktop/index.html` (`<title>`). Doing it before the first public
release costs nothing; doing it after costs URLs, links, and recognition.

LAWYER REVIEW RECOMMENDED if the project is ever commercialised.

## Privacy

**The application collects nothing, transmits nothing to the internet, and has
no server component.**

Confirmed NOT PRESENT: user accounts, login, cloud saves, cloud database,
analytics, telemetry, crash reporting, advertising, in-app purchases, payment
handling, user uploads, voice chat, text chat with strangers, third-party SDKs,
cookies, and browser storage APIs (`localStorage`, `sessionStorage`,
`indexedDB` — all absent).

What data exists, and where it stays:

| Data | Where it goes |
|---|---|
| Display name, sound and motion settings | A JSON file in the OS user-data directory. Never leaves the machine. |
| Player name and submitted words during LAN play | Sent only to peers on the local network the user explicitly joined. |
| LAN discovery beacon (room id, port, room name) | UDP broadcast on the local network only. Not routable to the internet. |

The only outbound network capability is LAN WebSocket play, which the user
initiates. The two `raw.githubusercontent.com` URLs in the repository belong to
`tools/fetch-dictionary.mjs`, a **developer** script for regenerating the word
list; it is not shipped and never runs in the app.

**A privacy policy is not legally required** for software in this shape, and no
`PRIVACY.md` has been created. If a storefront demands one, the accurate text
is: *"This application does not collect, store, or transmit any personal data."*

## Security

Posture is strong and deliberate. Verified by inspection:

| Control | State |
|---|---|
| `sandbox` | `true` |
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `webviewTag` | `false` |
| `ipcRenderer` exposed to renderer | No — a fixed function set only, none taking a caller-supplied channel |
| `setWindowOpenHandler` | Returns `deny` |
| `will-navigate` | Prevented |
| Content-Security-Policy | Present and restrictive: `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` |
| `eval`, `new Function`, `innerHTML`, `dangerouslySetInnerHTML` | None present |
| `child_process`, `exec`, `spawn` | None present |
| Hardcoded secrets, API keys, tokens, passwords | None present |

`shell.openPath` is used once, to open the mods folder. Its argument is an
internally computed path, never user input — safe.

**Host authority is checked twice**, at the wire and again in the engine: a
client may only act as itself, and privileged intents are refused before
parsing. Inbound WebSocket messages are size-capped and validated against an
explicit allowlist.

**Mods are data, not code.** There is no plugin entry point, so a downloaded
mod cannot execute anything, and every mod path is verified to resolve inside
the mods root.

Reporting policy: `SECURITY.md`.

### Fixed during a previous pass

- Mod path containment used string-prefix comparison against a root with a
  trailing `/`, which is wrong on Windows and rejected every legitimate mod.
  Replaced with `path.relative`. It failed *closed*, so this was a broken
  feature rather than a traversal hole. Verified against traversal attempts.
- The preload was built as ESM while the window sets `sandbox: true`. Electron
  requires sandboxed preloads to be CommonJS; the bridge silently failed and
  the app rendered a black screen. Fixed by bundling to `preload.cjs` —
  **without** weakening the sandbox.

## Secrets

None. Searched for API keys, tokens, passwords, credentials, private key
blocks, and provider-specific key prefixes across all tracked source. Only
matches were the unrelated word "tokens" in a CSS comment and the `js-tokens`
package name in the lockfile.

No `.env` file exists. `node_modules`, `dist`, `dist-electron`, and `release`
are correctly git-ignored and were verified absent from the tracked file list.

## Requested gameplay features

| Feature | State |
|---|---|
| Pause and resume mid-game | Implemented in the reducer. `Esc` or the header button. |
| Bots frozen while paused | Implemented and tested — a queued bot answer is shifted by the paused duration rather than firing on resume. |
| Editable bot names | Implemented. Click-to-edit in the lobby, trimmed, capped at 24 chars, blanks refused. |
| Green accent instead of orange | Implemented. Fuse deliberately left amber. |

78 engine tests pass, including 12 covering pause and renaming.

## Known cosmetic issues (not blockers)

- Declared display fonts are neither bundled nor fetched, so the UI renders in
  the system font. Fix by either bundling the font files (check their licence
  first — that would introduce the project's only third-party asset) or by
  removing the declaration.
- No application icon; packaged builds show the default Electron icon.

## Release checklist

Before tagging a release:

- [ ] Resolve the name decision (Trademark, above)
- [ ] Set the real `repository` URL in `package.json`
- [ ] `npm ci && npm test` — expect 78 passing
- [ ] `npm run typecheck` — expect clean
- [ ] `npm run build` — expect clean
- [ ] `npm run package` — produces an installer in `apps/desktop/release`
- [ ] Confirm `LICENSE.txt`, `THIRD_PARTY_NOTICES.md`, and
      `data/LICENSE-DICTIONARY.txt` are present in the packaged output
- [ ] Confirm no project-owned metadata declares an open-source licence
      (`grep -rn '"license"' package.json apps/*/package.json packages/*/package.json`)
- [ ] Launch the packaged build once and play a round — packaging bugs do not
      show up in `npm run dev`
- [ ] Tag the release and write release notes from `CHANGELOG.md`

Not yet verified anywhere: **LAN play between two physical machines**, and the
packaged installer has never been produced or run. Both are worth doing before
calling a release final.
