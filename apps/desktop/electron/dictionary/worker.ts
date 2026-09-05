import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { Dictionary } from '@bombparty/engine';

/**
 * Dictionary construction, off the main thread.
 *
 * Two reasons this is a worker rather than an async function: building the trie
 * and the n-gram index is a solid second of synchronous CPU work, and Electron's
 * main process is where every window's IPC is serviced. Blocking it stalls the
 * UI even though the UI is in a different process.
 *
 * The worker prefers a cached binary table and falls back to building one from
 * the text list, writing the cache on the way out so this only ever costs a
 * second once per dictionary change.
 */

export interface WorkerRequest {
  readonly wordListPath: string;
  readonly cachePath: string;
  readonly modWordPaths: readonly string[];
  readonly minLength: number;
}

export interface WorkerResponse {
  readonly ok: true;
  readonly buffer: ArrayBuffer;
  readonly words: number;
  readonly ms: number;
  readonly fromCache: boolean;
}

export interface WorkerFailure {
  readonly ok: false;
  readonly message: string;
}

const build = (request: WorkerRequest): WorkerResponse => {
  const started = Date.now();
  const useCache = request.modWordPaths.length === 0 && existsSync(request.cachePath);

  if (useCache) {
    try {
      const cached = readFileSync(request.cachePath);
      // Copy into a standalone ArrayBuffer: Node's Buffer is a view into a
      // shared pool, and transferring the pool would hand the main process far
      // more memory than it asked for.
      const buffer = cached.buffer.slice(
        cached.byteOffset,
        cached.byteOffset + cached.byteLength,
      ) as ArrayBuffer;
      const dictionary = Dictionary.fromBinary(buffer);
      return {
        ok: true,
        buffer,
        words: dictionary.size,
        ms: Date.now() - started,
        fromCache: true,
      };
    } catch {
      // A cache that fails to load is a cache worth rebuilding, not an error to
      // surface: fall through silently.
    }
  }

  const lines = readFileSync(request.wordListPath, 'utf8').split('\n');
  for (const modPath of request.modWordPaths) {
    try {
      lines.push(...readFileSync(modPath, 'utf8').split('\n'));
    } catch {
      // A malformed mod file must not stop the game from starting.
    }
  }

  const dictionary = Dictionary.fromWordList(lines, { minLength: request.minLength });
  const buffer = dictionary.toBinary();

  if (request.modWordPaths.length === 0) {
    try {
      mkdirSync(dirname(request.cachePath), { recursive: true });
      writeFileSync(request.cachePath, Buffer.from(buffer));
    } catch {
      // A read-only install directory is not a reason to fail the launch.
    }
  }

  return { ok: true, buffer, words: dictionary.size, ms: Date.now() - started, fromCache: false };
};

try {
  const response = build(workerData as WorkerRequest);
  parentPort?.postMessage(response, [response.buffer]);
} catch (error) {
  const failure: WorkerFailure = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
  parentPort?.postMessage(failure);
}
