import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  encode,
  type AdapterHandshake,
  type ConnectionStatus,
  type GameEvent,
  type GameSnapshot,
  type INetworkAdapter,
  type Intent,
  type PlayerId,
  type RoomId,
} from '@bombparty/engine';

/**
 * LAN client transport.
 *
 * Implements the same `INetworkAdapter` the local session uses, so everything
 * above it — the renderer, the event plumbing, the snapshot handling — is
 * identical whether the game is single-player or four machines on a kitchen
 * WiFi. The only thing that changes is which class was constructed.
 *
 * Reconnection is built in rather than bolted on: the player id from the
 * original handshake is replayed on every attempt, so a laptop that sleeps for
 * twenty seconds returns to its own seat with its own lives instead of joining
 * as a stranger.
 */

const PING_INTERVAL_MS = 2_000;
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000];

export interface LanClientOptions {
  readonly address: string;
  readonly port: number;
  readonly playerName: string;
  readonly playerId?: PlayerId;
}

export class LanClientAdapter implements INetworkAdapter {
  readonly kind = 'lan-client' as const;

  private socket: WebSocket | null = null;
  private snapshot: GameSnapshot | null = null;
  private playerId: PlayerId | null = null;
  private roomId: RoomId | null = null;
  private latency = 0;
  private attempt = 0;
  private closing = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private readonly eventListeners = new Set<(event: GameEvent) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(private readonly options: LanClientOptions) {
    this.playerId = options.playerId ?? null;
  }

  connect(): Promise<AdapterHandshake> {
    this.closing = false;
    this.setStatus({ state: 'connecting' });
    return this.openSocket();
  }

  private openSocket(): Promise<AdapterHandshake> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.options.address}:${this.options.port}`;
      const socket = new WebSocket(url, { handshakeTimeout: 5_000 });
      this.socket = socket;
      let settled = false;

      socket.on('open', () => {
        this.attempt = 0;
        socket.send(
          encode({
            v: PROTOCOL_VERSION,
            type: 'HELLO',
            name: this.options.playerName,
            ...(this.playerId !== null ? { playerId: this.playerId } : {}),
          }),
        );
        this.startPinging();
      });

      socket.on('message', (raw) => {
        const message = decodeServerMessage(raw.toString());
        if (message === null) return;

        switch (message.type) {
          case 'WELCOME':
            this.playerId = message.playerId;
            this.roomId = message.roomId;
            this.snapshot = message.snapshot;
            this.setStatus({ state: 'connected', latencyMs: this.latency });
            if (!settled) {
              settled = true;
              resolve({
                playerId: message.playerId,
                roomId: message.roomId,
                snapshot: message.snapshot,
              });
            }
            return;

          case 'EVENT':
            if (message.event.type === 'STATE_SYNC') {
              // Snapshots can arrive out of order after a reconnect; version is
              // monotonic on the host, so an older one is simply dropped.
              const incoming = message.event.snapshot;
              if (this.snapshot !== null && incoming.version < this.snapshot.version) return;
              this.snapshot = incoming;
            }
            for (const listener of this.eventListeners) listener(message.event);
            return;

          case 'PONG':
            this.latency = Math.max(0, Date.now() - message.t);
            return;

          case 'REJECT':
            this.setStatus({ state: 'closed', reason: `${message.code}: ${message.message}` });
            if (!settled) {
              settled = true;
              reject(new Error(`${message.code}: ${message.message}`));
            }
            return;

          default:
            return;
        }
      });

      socket.on('close', () => {
        this.stopPinging();
        if (this.closing) {
          this.setStatus({ state: 'closed', reason: 'left the room' });
          return;
        }
        if (!settled) {
          settled = true;
          reject(new Error('connection closed during handshake'));
          return;
        }
        void this.scheduleReconnect();
      });

      socket.on('error', () => {
        // 'close' always follows, and that is where reconnection is decided.
        // Handling both would double-schedule the backoff.
      });
    });
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.closing) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] as number;
    this.attempt += 1;
    this.setStatus({ state: 'reconnecting', attempt: this.attempt });
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.closing) return;
    try {
      await this.openSocket();
    } catch {
      void this.scheduleReconnect();
    }
  }

  private startPinging(): void {
    this.stopPinging();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(encode({ v: PROTOCOL_VERSION, type: 'PING', t: Date.now() }));
    }, PING_INTERVAL_MS);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.stopPinging();
    this.socket?.close();
    this.socket = null;
    this.eventListeners.clear();
    this.statusListeners.clear();
  }

  send(intent: Intent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encode({ v: PROTOCOL_VERSION, type: 'INTENT', intent }));
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
    return this.latency;
  }

  currentPlayerId(): PlayerId | null {
    return this.playerId;
  }

  currentRoomId(): RoomId | null {
    return this.roomId;
  }

  private setStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
