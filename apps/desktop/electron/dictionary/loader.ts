import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Dictionary } from '@bombparty/engine';
import type { WorkerFailure, WorkerRequest, WorkerResponse } from './worker.js';

export interface LoadResult {
  readonly dictionary: Dictionary;
  readonly words: number;
  readonly ms: number;
  readonly fromCache: boolean;
}

/**
 * Spawn the build worker and rehydrate its output.
 *
 * The buffer arrives as a transfer rather than a copy, so a 20MB table crosses
 * the thread boundary as a pointer hand-off; `Dictionary.fromBinary` then wraps
 * it in views. Total main-thread cost is the TextDecoder pass, tens of
 * milliseconds, instead of the full second the build takes.
 */
export const loadDictionary = (request: WorkerRequest): Promise<LoadResult> =>
  new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./worker.js', import.meta.url));
    const worker = new Worker(workerPath, { workerData: request });

    worker.once('message', (message: WorkerResponse | WorkerFailure) => {
      if (!message.ok) {
        reject(new Error(message.message));
        return;
      }
      resolve({
        dictionary: Dictionary.fromBinary(message.buffer),
        words: message.words,
        ms: message.ms,
        fromCache: message.fromCache,
      });
    });

    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`dictionary worker exited with code ${code}`));
    });
  });
