/** Entry point: `npm test` in packages/engine. */
import './rng.test.js';
import './dictionary.test.js';
import './syllables.test.js';
import './protocol.test.js';
import './engine.test.js';
import './pause.test.js';
import './alphabet.test.js';
import './elimination.test.js';
import { run } from './harness.js';

process.exitCode = await run();
