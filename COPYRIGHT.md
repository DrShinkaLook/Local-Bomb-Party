# Copyright and provenance

## Ownership

Copyright © 2026 **Kobi Dao**. All Rights Reserved.

All original source code, documentation, and design in this repository is
owned by Kobi Dao and is **proprietary**. It is not open-source software. See
`LICENSE.txt` for the terms.

This claim covers only material authored by or on behalf of Kobi Dao. It does
**not** extend to third-party components, which retain their own copyrights
and licences and are unaffected by it — see `THIRD_PARTY_NOTICES.md`.

No employer, client, school, or third party holds a claim to this work. If that
changes — for example if any of it is written during employment with an IP
assignment clause, or as coursework under an institutional IP policy — this
statement needs revisiting before release. **LAWYER REVIEW RECOMMENDED** if
that applies.

## AI provenance

Parts of this codebase were written with AI assistance (Anthropic's Claude),
directed by Kobi Dao. This is disclosed because it affects copyright, and the
position is worth stating plainly rather than leaving ambiguous:

- Under current US Copyright Office guidance, purely machine-generated
  expression is not itself protected by copyright. Human authorship is what is
  protected — the selection, arrangement, direction, and modification of the
  work.
- The architecture, requirements, design constraints, and all decisions here
  were made by the owner, with AI used as a writing tool under that direction.
- Commit history records this: AI-assisted commits carry a
  `Co-Authored-By: Claude` trailer.

Practical consequence: **if registering this work with the US Copyright Office,
AI-generated material must be disclosed and disclaimed** on the application,
and the claim limited to the human-authored contribution. See the registration
section below. **LAWYER REVIEW RECOMMENDED** before filing.

Note that copyright subsists automatically on creation; registration is a
separate, optional step that mainly affects enforcement remedies. Proprietary
status does not depend on it.

## Registration status

**NOT REGISTERED / REGISTRATION NOT YET VERIFIED.**

No application has been filed with the US Copyright Office or any other
registry, and no registration number exists. Do not state or imply otherwise
in any listing, README, or store page.

## Clean-room status

This project is an independent implementation of a well-known word game
format. The specific position:

- Game *mechanics* and *rules* are not protected by copyright. Reimplementing
  a word-bomb game is lawful.
- No code, artwork, audio, word data, syllable table, or network protocol in
  this repository is copied from, derived from, or reverse-engineered from
  JKLM.fun or any third-party client for it. See `docs/CLEAN-ROOM.md`.
- A third-party Python client for JKLM.fun was explicitly **refused** as a
  reference during development, specifically to avoid dirty-room contamination
  of the protocol and data.

## Asset provenance

There are no third-party assets. The repository contains no images, icons,
fonts, audio files, or video. All sound is synthesised at runtime; all
graphics are drawn procedurally. The only third-party *data* is the SCOWL
word list, which is permissively licensed and attributed — see
`THIRD_PARTY_NOTICES.md`.

## Trademark

"Bomb Party" is **not** a distinctive name and is shared with a game mode on
JKLM.fun. This is a naming risk, not a copyright one, and it is unresolved.
See the trademark section of `RELEASE_SAFETY_AUDIT.md` for the decision that
still needs making.

## Preparing a US copyright registration

If registering, the following is what an application typically needs. This is
preparation, not legal advice.

1. **Work type** — Computer program.
2. **Title** — the final product name (see the trademark decision first;
   registering under a name you later abandon wastes the filing).
3. **Author** — Kobi Dao. Not a work made for hire, assuming the ownership
   statement above holds.
4. **Year of completion** — 2026.
5. **Publication** — whether the code has been made public, and the date. This
   changes the deposit requirements, so decide *before* pushing publicly if
   you intend to register.
6. **Deposit material** — for source code, the usual deposit is the first 25
   and last 25 pages of source, with trade secrets optionally redacted. This
   project's source is small enough that the entire codebase is a practical
   deposit.
7. **Limitation of claim** — this is the part that matters here. Exclude:
   - AI-generated material, disclosed as such.
   - The SCOWL word list (third-party, licensed).
   - Third-party libraries (Electron, React, ws).

   The claim covers the human-authored code and its selection and arrangement.

Generate a clean deposit snapshot with:

```
git archive --format=zip -o bombparty-deposit.zip HEAD
```

**LAWYER REVIEW RECOMMENDED** before filing, particularly on the AI disclosure
and the scope of the limitation of claim.
