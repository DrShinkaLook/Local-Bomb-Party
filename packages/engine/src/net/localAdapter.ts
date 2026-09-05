import type { GameEvent, GameSnapshot, Intent, PlayerId, RoomId } from '../types.js';
import type { GameEngine } from '../game/engine.js';
import type {
  AdapterHandshake,
  ConnectionStatus,
  INetworkAdapter,
} from './INetworkAdapter.js';

/**
 * In-process transport.
 *
 * Single-player is not a special case of the game — it is the ordinary game
 * played over a transport whose "network" is a function call. Intents go
 * through the same authorisation path, events arrive through the same
 * subscription, and the renderer cannot tell the difference. When LAN support
 * regresses, single-player regresses with it and the tests notice.
 */
export class LocalAdapter implements INetworkAdapter {
  readonly kind = 'local' as const;

  private readonly eventListeners = new Set<(event: GameEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private snapshot: GameSnapshot | null = null;
  private unsubscribe: (() => void) | null = null;
  private playerId: PlayerId | null = null;

  constructor(
    private readonly engine: GameEngine,
    private readonly playerName: string,
  ) {}

  async connect(): Promise<AdapterHandshake> {
    this.setStatus({ state: 'connecting' });

    this.unsubscribe = this.engine.subscribe((event) => {
      if (event.type === 'STATE_SYNC') this.snapshot = event.snapshot;
      for (const listener of this.eventListeners) listener(event);
    });

    this.playerId = this.engine.addLocalPlayer(this.playerName);
    const snapshot = this.engine.snapshot();
    this.snapshot = snapshot;
    this.setStatus({ state: 'connected', latencyMs: 0 });

    return { playerId: this.playerId, roomId: snapshot.roomId as RoomId, snapshot };
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setStatus({ state: 'closed', reason: 'local session ended' });
    this.eventListeners.clear();
    this.statusListeners.clear();
  }

  send(intent: Intent): void {
    // Passing the player id as origin exercises the same authorisation check a
    // LAN client would face, so a bug that lets a client act as someone else
    // shows up in single-player tests too.
    this.engine.dispatch(intent, this.playerId);
  }

  /** Host-privileged actions, available only because this client *is* the host. */
  hostDispatch(intent: Intent): void {
    this.engine.dispatch(intent, null);
  }

  onEvent(listener: (event: GameEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  latestSnapshot(): GameSnapshot | null {
    return this.snapshot;
  }

  latencyMs(): number {
    return 0;
  }

  private setStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
