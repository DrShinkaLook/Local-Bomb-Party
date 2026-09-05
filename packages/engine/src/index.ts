/** Public surface of the headless engine. Nothing outside this file is API. */

export * from './types.js';
export { Rng, type RngState } from './util/rng.js';

export { Dictionary, type DictionaryOptions } from './dictionary/dictionary.js';
export {
  SyllableGenerator,
  type SyllableGeneratorOptions,
  type SyllablePools,
} from './dictionary/syllables.js';
export { CompiledTrie, TrieBuilder, isLowerAlpha } from './dictionary/trie.js';
export { NgramIndex } from './dictionary/ngramIndex.js';
export {
  BINARY_FORMAT_VERSION,
  deserializeDictionary,
  serializeDictionary,
} from './dictionary/binary.js';

export {
  COUNTDOWN_MS,
  EXPLOSION_PAUSE_MS,
  alivePlayers,
  currentPlayerId,
  initialState,
  makePlayer,
  nextAliveSeat,
  playerById,
  reduce,
  type Command,
  type EngineContext,
  type Transition,
} from './game/machine.js';
export {
  GameEngine,
  systemClock,
  type Clock,
  type GameEngineOptions,
} from './game/engine.js';

export { Bot, type BotDecision } from './bots/bot.js';
export { BOT_PROFILES, type BotProfile } from './bots/profiles.js';

export {
  PROTOCOL_VERSION,
  decodeBeacon,
  decodeClientMessage,
  decodeServerMessage,
  encode,
  isValidIntent,
  type ClientMessage,
  type DiscoveryBeacon,
  type ServerMessage,
} from './net/protocol.js';
export type {
  AdapterHandshake,
  ConnectionStatus,
  DiscoveredHost,
  IDiscoveryService,
  INetworkAdapter,
} from './net/INetworkAdapter.js';
export { LocalAdapter } from './net/localAdapter.js';
