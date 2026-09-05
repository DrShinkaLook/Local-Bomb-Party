import type { GameEvent, GameSnapshot, Intent, PlayerId, RoomId } from '../types.js';
import type { DiscoveryBeacon } from './protocol.js';

/**
 * The seam between the game and its transport.
 *
 * Single-player, LAN and a future internet relay differ only in how bytes
 * move; the game above this interface cannot tell them apart. The React layer
 * talks to an `INetworkAdapter` and never to a socket, which is what allows
 * single-player to be "a LAN game with a loopback transport" rather than a
 * separate code path that drifts out of sync with the real one.
 *
 * Adapters are responsible for transport concerns only: connection lifecycle,
 * framing, reconnection, and discovery. Validation and authority live in the
 * engine, on the host.
 */
export interface INetworkAdapter {
  readonly kind: 'local' | 'lan-host' | 'lan-client' | 'relay';

  /** Resolves once the adapter is ready to carry intents. */
  connect(): Promise<AdapterHandshake>;

  disconnect(): Promise<void>;

  /** Send an input intent towards whoever holds authority. */
  send(intent: Intent): void;

  /** Subscribe to authoritative events. Returns an unsubscribe function. */
  onEvent(listener: (event: GameEvent) => void): () => void;

  /** Connection-level status, distinct from game state. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;

  /** Most recent authoritative snapshot, or null before the first sync. */
  latestSnapshot(): GameSnapshot | null;

  /** Round-trip estimate in milliseconds; 0 for the local adapter. */
  latencyMs(): number;
}

export interface AdapterHandshake {
  readonly playerId: PlayerId;
  readonly roomId: RoomId;
  readonly snapshot: GameSnapshot;
}

export type ConnectionStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'connecting' }
  | { readonly state: 'connected'; readonly latencyMs: number }
  | { readonly state: 'reconnecting'; readonly attempt: number }
  | { readonly state: 'closed'; readonly reason: string };

/**
 * LAN host discovery. Kept separate from `INetworkAdapter` because discovery is
 * a concern of the *lobby browser*, not of a connected session, and because a
 * relay transport will implement one without the other.
 */
export interface IDiscoveryService {
  /** Begin listening for host beacons. */
  start(): Promise<void>;
  stop(): Promise<void>;
  onHostSeen(listener: (beacon: DiscoveryBeacon, address: string) => void): () => void;
  /** Hosts currently believed to be live, sorted by most recently seen. */
  knownHosts(): readonly DiscoveredHost[];
}

export interface DiscoveredHost {
  readonly beacon: DiscoveryBeacon;
  readonly address: string;
  readonly lastSeen: number;
}
