import type { GameEvent, GameSnapshot, Intent, PlayerId, RoomId } from '../types.js';

/**
 * The wire protocol.
 *
 * One versioned JSON envelope in each direction. Everything a transport moves
 * is described here, so a new transport (LAN WebSocket today, a relay server
 * later) only has to move bytes — it never invents message shapes.
 *
 * Design rules this protocol holds to:
 *
 *   1. Clients send *intents*, never state. There is no message a client can
 *      send that asserts a fact about the game.
 *   2. The host sends *events*, and every event that changes state is
 *      accompanied by (or is) a `STATE_SYNC`. A client that misses events can
 *      always recover from the next snapshot without a replay log.
 *   3. Every message carries the protocol version. Mismatches are refused at
 *      handshake with a readable reason rather than failing later as a
 *      confusing runtime error.
 */

export const PROTOCOL_VERSION = 1 as const;

/** UDP discovery beacon payload, broadcast by hosts on the LAN. */
export interface DiscoveryBeacon {
  readonly kind: 'bombparty-host';
  readonly v: typeof PROTOCOL_VERSION;
  readonly roomId: RoomId;
  readonly roomName: string;
  readonly port: number;
  readonly players: number;
  readonly maxPlayers: number;
  readonly inProgress: boolean;
  /** Monotonic host uptime marker; lets clients drop stale beacons. */
  readonly sentAt: number;
}

export type ClientMessage =
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'HELLO';
      readonly name: string;
      /** Present when reconnecting to reclaim a seat. */
      readonly playerId?: PlayerId;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'INTENT'; readonly intent: Intent }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'PING'; readonly t: number };

export type ServerMessage =
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'WELCOME';
      readonly playerId: PlayerId;
      readonly roomId: RoomId;
      readonly snapshot: GameSnapshot;
    }
  | { readonly v: typeof PROTOCOL_VERSION; readonly type: 'EVENT'; readonly event: GameEvent }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'REJECT';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly v: typeof PROTOCOL_VERSION;
      readonly type: 'PONG';
      readonly t: number;
      readonly serverTime: number;
    };

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export const encode = (message: ClientMessage | ServerMessage): string =>
  JSON.stringify(message);

/**
 * Parse and validate an inbound frame.
 *
 * Hand-written guards rather than a schema library: the engine ships with zero
 * runtime dependencies, and the message set is small enough that the guards are
 * cheaper to read than a schema. They are deliberately strict — anything a
 * guard does not recognise is refused, because on the host side this function
 * is the trust boundary between the room and the network.
 */
export const decodeClientMessage = (raw: string): ClientMessage | null => {
  const parsed = safeParse(raw);
  if (parsed === null || !isRecord(parsed)) return null;
  if (parsed['v'] !== PROTOCOL_VERSION) return null;

  switch (parsed['type']) {
    case 'HELLO': {
      const name = parsed['name'];
      if (typeof name !== 'string' || name.length === 0 || name.length > 24) return null;
      const playerId = parsed['playerId'];
      if (playerId !== undefined && typeof playerId !== 'string') return null;
      return playerId === undefined
        ? { v: PROTOCOL_VERSION, type: 'HELLO', name }
        : { v: PROTOCOL_VERSION, type: 'HELLO', name, playerId: playerId as PlayerId };
    }
    case 'INTENT': {
      const intent = parsed['intent'];
      if (!isValidIntent(intent)) return null;
      return { v: PROTOCOL_VERSION, type: 'INTENT', intent };
    }
    case 'PING': {
      const t = parsed['t'];
      if (typeof t !== 'number' || !Number.isFinite(t)) return null;
      return { v: PROTOCOL_VERSION, type: 'PING', t };
    }
    default:
      return null;
  }
};

export const decodeServerMessage = (raw: string): ServerMessage | null => {
  const parsed = safeParse(raw);
  if (parsed === null || !isRecord(parsed)) return null;
  if (parsed['v'] !== PROTOCOL_VERSION) return null;

  switch (parsed['type']) {
    case 'WELCOME':
    case 'EVENT':
    case 'REJECT':
    case 'PONG':
      // The host is trusted by construction: a client that does not trust the
      // host it chose to join has already lost. Shape is checked, contents are
      // not re-validated.
      return parsed as unknown as ServerMessage;
    default:
      return null;
  }
};

export const decodeBeacon = (raw: string): DiscoveryBeacon | null => {
  const parsed = safeParse(raw);
  if (parsed === null || !isRecord(parsed)) return null;
  if (parsed['kind'] !== 'bombparty-host') return null;
  if (parsed['v'] !== PROTOCOL_VERSION) return null;
  if (typeof parsed['port'] !== 'number') return null;
  if (typeof parsed['roomId'] !== 'string') return null;
  return parsed as unknown as DiscoveryBeacon;
};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_WORD_LENGTH = 64;

/**
 * Only the intents a *remote client* is allowed to express are accepted here.
 * Privileged intents (START_GAME, SET_RULES, ADD_BOT, REMOVE_PLAYER) are
 * refused at the wire, before they reach the engine's own authorisation check.
 * Two layers, because the cost of the second one is a switch statement.
 */
export const isValidIntent = (value: unknown): value is Intent => {
  if (!isRecord(value)) return false;
  switch (value['type']) {
    case 'JOIN':
      return typeof value['playerId'] === 'string' && typeof value['name'] === 'string';
    case 'LEAVE':
      return typeof value['playerId'] === 'string';
    case 'TYPING':
      return (
        typeof value['playerId'] === 'string' &&
        typeof value['text'] === 'string' &&
        (value['text'] as string).length <= MAX_WORD_LENGTH
      );
    case 'SUBMIT_WORD':
      return (
        typeof value['playerId'] === 'string' &&
        typeof value['word'] === 'string' &&
        (value['word'] as string).length > 0 &&
        (value['word'] as string).length <= MAX_WORD_LENGTH
      );
    default:
      return false;
  }
};
