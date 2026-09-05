import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { ModSummary } from './ipc.js';

/**
 * Mod discovery and loading.
 *
 * A mod is a folder under `mods/`. Everything in it is optional:
 *
 *   mods/<name>/custom_words.txt      one word per line
 *   mods/<name>/custom_syllables.json { "common": [...], "uncommon": [...], "rare": [...] }
 *   mods/<name>/theme.json            CSS custom property overrides
 *   mods/<name>/audio/*.wav|ogg|mp3   replacement cues, matched by file stem
 *
 * Two rules keep this safe. First, mods are *data*, never code — there is no
 * plugin entry point to execute, so a downloaded mod cannot run anything.
 * Second, every path is resolved and checked to be inside the mods root before
 * it is read, so a crafted name cannot walk out of the folder.
 */

const MAX_MOD_FILE_BYTES = 32 * 1024 * 1024;

export interface LoadedMod {
  readonly name: string;
  readonly wordFile: string | null;
  readonly syllables: {
    common?: string[];
    uncommon?: string[];
    rare?: string[];
  } | null;
  readonly theme: Record<string, string> | null;
  readonly audioFiles: readonly string[];
}

export class ModRegistry {
  private mods: LoadedMod[] = [];
  private watcher: ReturnType<typeof watch> | null = null;
  private readonly listeners = new Set<(mods: readonly ModSummary[]) => void>();
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly root: string) {}

  get modsRoot(): string {
    return this.root;
  }

  /** Rescan from disk. Cheap enough to call on every file-system event. */
  scan(): readonly LoadedMod[] {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
      this.mods = [];
      return this.mods;
    }

    const found: LoadedMod[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.root, entry.name);
      if (!this.isInsideRoot(dir)) continue;

      found.push({
        name: entry.name,
        wordFile: this.fileIfPresent(join(dir, 'custom_words.txt')),
        syllables: this.readJson(join(dir, 'custom_syllables.json')),
        theme: this.readJson(join(dir, 'theme.json')),
        audioFiles: this.listAudio(join(dir, 'audio')),
      });
    }
    this.mods = found;
    return this.mods;
  }

  loaded(): readonly LoadedMod[] {
    return this.mods;
  }

  summaries(): readonly ModSummary[] {
    return this.mods.map((mod) => ({
      name: mod.name,
      words: mod.wordFile === null ? 0 : this.countLines(mod.wordFile),
      syllables:
        (mod.syllables?.common?.length ?? 0) +
        (mod.syllables?.uncommon?.length ?? 0) +
        (mod.syllables?.rare?.length ?? 0),
      hasTheme: mod.theme !== null,
      hasAudio: mod.audioFiles.length > 0,
    }));
  }

  /** Every mod word file, in scan order, for the dictionary worker. */
  wordFiles(): readonly string[] {
    return this.mods.map((m) => m.wordFile).filter((p): p is string => p !== null);
  }

  /** Merged syllable overrides across all mods. */
  syllableOverrides(): { common: string[]; uncommon: string[]; rare: string[] } {
    const merged = { common: [] as string[], uncommon: [] as string[], rare: [] as string[] };
    for (const mod of this.mods) {
      merged.common.push(...(mod.syllables?.common ?? []));
      merged.uncommon.push(...(mod.syllables?.uncommon ?? []));
      merged.rare.push(...(mod.syllables?.rare ?? []));
    }
    return merged;
  }

  /**
   * Watch for changes. Debounced, because a file copy produces a burst of
   * events and rebuilding the dictionary once per event would be miserable.
   */
  startWatching(): void {
    if (this.watcher !== null) return;
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true });

    this.watcher = watch(this.root, { recursive: true }, () => {
      if (this.debounce !== null) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.scan();
        const summaries = this.summaries();
        for (const listener of this.listeners) listener(summaries);
      }, 400);
    });
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = null;
  }

  onChange(listener: (mods: readonly ModSummary[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------

  private isInsideRoot(candidate: string): boolean {
    // `relative` is the only containment test that is correct on both
    // separators. A string prefix check is not: on Windows the resolved paths
    // use backslashes, so comparing against a root with a trailing "/" rejects
    // every legitimate mod — which silently disabled mods entirely on Windows.
    const rel = relative(this.root, candidate);
    if (rel === '') return true;
    // "..": climbs out of the root. Absolute: a different drive or UNC root.
    return !rel.startsWith('..') && !isAbsolute(rel);
  }

  private fileIfPresent(path: string): string | null {
    try {
      const info = statSync(path);
      if (!info.isFile() || info.size > MAX_MOD_FILE_BYTES) return null;
      return path;
    } catch {
      return null;
    }
  }

  private readJson<T>(path: string): T | null {
    const file = this.fileIfPresent(path);
    if (file === null) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private listAudio(dir: string): readonly string[] {
    try {
      return readdirSync(dir)
        .filter((name) => /\.(wav|ogg|mp3)$/i.test(name))
        .map((name) => join(dir, name));
    } catch {
      return [];
    }
  }

  private countLines(path: string): number {
    try {
      let count = 0;
      const text = readFileSync(path, 'utf8');
      for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
      return count;
    } catch {
      return 0;
    }
  }
}
