# Mods

Drop a folder in here. Every file is optional.

```
mods/
  my-mod/
    custom_words.txt        one word per line; # starts a comment
    custom_syllables.json   { "common": [], "uncommon": [], "rare": [] }
    theme.json              CSS custom property overrides
    audio/                  wav / ogg / mp3, matched to cue names
```

Audio file stems map to cues: `tick`, `accept`, `reject`, `explode`,
`eliminate`, `lifeGained`, `turnStart`, `victory`.

Two things worth knowing:

**Mods are data, never code.** There is no plugin entry point, nothing in a mod
is executed, and every path is checked to be inside the mods folder before it is
read. A mod you download cannot run anything on your machine.

**Custom syllables are still checked against the dictionary.** If your word list
cannot satisfy a syllable you declared, it is dropped rather than handed to a
player as an unwinnable turn. Add the words first, then the syllable.

Changes are picked up automatically — the game watches this folder.
