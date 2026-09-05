import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  asPlayerId,
  decodeClientMessage,
  encode,
  type GameEngine,
  type GameEvent,
  type PlayerId,
  type ServerMessage,
} from '@bombparty/engine';

/**
 * WebSocket server for LAN play.
 *
 * This class is deliberately thin. It owns sockets, framing and identity, and
 * nothing else: every inbound message becomes an `Intent` dispatched to the
 * engine with the sender's authenticated player id, and every engine event is
 * fanned out to sockets. All the rules live in the engine, so a client cannot
 * reach a game rule by finding a bug in the transport.
 *
 * Abuse handling is per-connection rather than global, so one misbehaving peer
 * cannot starve the room.
 */

const MAX_MESSAGE_BYTES = 4 * 1024;
const MAX_MESSAGES_PER_SECOND = 40;
const MAX_CLIENTS = 16;

interface Peer {
  readonly socket: WebSocket;
  playerId: PlayerId | null;
  windowStart: number;
  messagesInWindow: number;
}

export class LanHost {
  private server: WebSocketServer | null = null;
  private readonly peers = new Map<WebSocket, Peer>();
  private unsubscribe: (() => void) | null = null;
  private nextClientNumber = 0;

  constructor(private readonly engine: GameEngine) {}

  get port(): number | null {
    const address = this.server?.address();
    return address !== null && typeof address === 'object' ? address.port : null;
  }

  get clientCount(): number {
    return this.peers.size;
  }

  async listen(port = 0): Promise<number> {
    if (this.server !== null) return this.port ?? 0;

    const server = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    server.on('connection', (socket) => this.accept(socket));
    this.unsubscribe = this.engine.subscribe((event) => this.broadcast(event));
    return this.port ?? 0;
  }

  private accept(socket: WebSocket): void {
    if (this.peers.size >= MAX_CLIENTS) {
      this.sendTo(socket, { v: PROTOCOL_VERSION, type: 'REJECT', code: 'ROOM_FULL', message: 'Room is full' });
      socket.close();
      return;
    }

    const peer: Peer = { socket, playerId: null, windowStart: Date.now(), messagesInWindow: 0 };
    this.peers.set(socket, peer);

    socket.on('message', (raw) => this.onMessage(peer, raw.toString()));
    socket.on('close', () => this.onClose(peer));
    socket.on('error', () => socket.close());
  }

  private onMessage(peer: Peer, raw: string): void {
    if (!this.underRateLimit(peer)) {
      this.sendTo(peer.socket, {
        v: PROTOCOL_VERSION,
        type: 'REJECT',
        code: 'RATE_LIMIT',
        message: 'Too many messages',
      });
      peer.socket.close();
      return;
    }

    const message = decodeClientMessage(raw);
    if (message === null) {
      // Unparseable or refused by the schema. Say so and keep the connection:
      // a version mismatch should produce a readable message, not a silent drop.
      this.sendTo(peer.socket, {
        v: PROTOCOL_VERSION,
        type: 'REJECT',
        code: 'BAD_MESSAGE',
        message: `Message rejected (protocol v${PROTOCOL_VERSION} expected)`,
      });
      return;
    }

    switch (message.type) {
      case 'HELLO': {
        // Reconnecting clients may reclaim a seat; new ones get a fresh id
        // minted by the host. A client never chooses its own identity, which is
        // what stops one peer impersonating another.
        const existing = message.playerId;
        const playerId =
          existing !== undefined && this.engine.hasPlayer(existing)
            ? existing
            : asPlayerId(`lan:${Date.now().toString(36)}:${(this.nextClientNumber += 1)}`);

        peer.playerId = playerId;
        this.engine.dispatch({ type: 'JOIN', playerId, name: message.name }, playerId);
        this.sendTo(peer.socket, {
          v: PROTOCOL_VERSION,
          type: 'WELCOME',
          playerId,
          roomId: this.engine.snapshot().roomId,
          snapshot: this.engine.snapshot(),
        });
        return;
      }

      case 'INTENT': {
        if (peer.playerId === null) return;
        this.engine.dispatch(message.intent, peer.playerId);
        return;
      }

      case 'PING':
        this.sendTo(peer.socket, {
          v: PROTOCOL_VERSION,
          type: 'PONG',
          t: message.t,
          serverTime: Date.now(),
        });
        return;

      default:
        return;
    }
  }

  private underRateLimit(peer: Peer): boolean {
    const now = Date.now();
    if (now - peer.windowStart >= 1_000) {
      peer.windowStart = now;
      peer.messagesInWindow = 0;
    }
    peer.messagesInWindow += 1;
    return peer.messagesInWindow <= MAX_MESSAGES_PER_SECOND;
  }

  private onClose(peer: Peer): void {
    this.peers.delete(peer.socket);
    // The seat is kept so the player can reconnect mid-round; only their
    // connected flag changes. Reaping abandoned seats is the lobby's job.
    if (peer.playerId !== null) {
      this.engine.dispatch({ type: 'LEAVE', playerId: peer.playerId }, peer.playerId);
    }
  }

  private broadcast(event: GameEvent): void {
    // BOMB_TICK is a local presentation cue. Clients derive their countdown
    // from `bombEndsAt` in the snapshot, so sending ten of these per second to
    // every peer would be pure waste.
    if (event.type === 'BOMB_TICK') return;
    const frame = encode({ v: PROTOCOL_VERSION, type: 'EVENT', event });
    for (const peer of this.peers.values()) {
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(frame);
    }
  }

  private sendTo(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(encode(message));
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const peer of this.peers.values()) peer.socket.close();
    this.peers.clear();
    const server = this.server;
    this.server = null;
    if (server === null) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
