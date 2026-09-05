import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from './ipc.js';

/**
 * Settings persistence: a single JSON file in the OS user-data directory.
 *
 * SQLite is the right answer once there is match history to query; for a
 * handful of preferences it would be a dependency, a migration story, and a
 * native build step in exchange for nothing. The storage seam is this file, so
 * swapping it later touches one module.
 */
export class SettingsStore {
  private cache: AppSettings | null = null;

  constructor(private readonly path: string) {}

  read(): AppSettings {
    if (this.cache !== null) return this.cache;
    try {
      if (existsSync(this.path)) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppSettings>;
        // Merge over defaults so a settings file written by an older build is
        // upgraded rather than rejected.
        this.cache = { ...DEFAULT_SETTINGS, ...parsed };
        return this.cache;
      }
    } catch {
      // Corrupt settings fall back to defaults rather than blocking launch.
    }
    this.cache = DEFAULT_SETTINGS;
    return this.cache;
  }

  write(settings: AppSettings): void {
    this.cache = { ...DEFAULT_SETTINGS, ...settings };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch {
      // Non-fatal: the session keeps the in-memory value.
    }
  }
}
