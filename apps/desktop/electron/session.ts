import {
  GameEngine,
  SyllableGenerator,
  asRoomId,
  type Dictionary,
  type GameEvent,
  type GameSnapshot,
  type Intent,
  type PlayerId,
} from '@bombparty/engine';
import { DiscoveryBroadcaster } from './net/discovery.js';
import { LanHost } from './net/lanHost.js';
import { LanClientAdapter } from './net/lanClient.js';
import type { HostRoomRequest, JoinRoomRequest, SessionHandle } from './ipc.js';
import { PROTOCOL_VERSION } from '@bombparty/engine';

/**
 * One live game session, hosted or joined, owned by the main process.
 *
 * The renderer never holds an engine, a socket, or a dictionary. It sends
 * intents and receives events, exactly like a remote LAN client does — the only
 * difference between hosting and joining, from the renderer's point of view, is
 * which methods return an error.
 */
export class Session {
  private engine: GameEngine | null = null;
  private host: LanHost | null = null;
  private beacon: DiscoveryBroadcaster | null = null;
  private client: LanClientAdapter | null = null;
  private unsubscribe: (() => void) | null = null;
  private localPlayerId: PlayerId | null = null;

  constructor(private readonly emit: (event: GameEvent) => void) {}

  get isHosting(): boolean {
    return this.engine !== null;
  }

  get playerId(): PlayerId | null {
    return this.localPlayerId;
  }

  snapshot(): GameSnapshot | null {
    if (this.engine !== null) return this.engine.snapshot();
    return this.client?.latestSnapshot() ?? null;
  }

  // -------------------------------------------------------------------------

  async startHosting(
    request: HostRoomRequest,
    dictionary: Dictionary,
    syllableOverrides: { common: string[]; uncommon: string[]; rare: string[] },
  ): Promise<SessionHandle> {
    await this.stop();

    const rules = request.rules ?? {};
    const syllables = new SyllableGenerator(dictionary, {
      minWords: rules.minWordsPerSyllable ?? 60,
      extraSyllables: syllableOverrides,
    });

    const engine = new GameEngine({
      roomId: asRoomId(`room-${Date.now().toString(36)}`),
      dictionary,
      seed: request.seed ?? `${Date.now()}`,
      rules,
      syllables,
    });
    this.engine = engine;
    this.unsubscribe = engine.subscribe((event) => this.emit(event));
    engine.startLoop();

    this.localPlayerId = engine.addLocalPlayer(request.playerName);

    let lanPort: number | null = null;
    if (request.lan) {
      this.host = new LanHost(engine);
      lanPort = await this.host.listen(request.port ?? 0);

      this.beacon = new DiscoveryBroadcaster(() => ({
        kind: 'bombparty-host',
        v: PROTOCOL_VERSION,
        roomId: engine.snapshot().roomId,
        roomName: request.roomName,
        port: lanPort as number,
        players: engine.snapshot().players.length,
        maxPlayers: 16,
        inProgress: engine.snapshot().phase.name !== 'lobby',
        sentAt: Date.now(),
      }));
      await this.beacon.start();
    }

    const snapshot = engine.snapshot();
    return {
      playerId: this.localPlayerId,
      roomId: snapshot.roomId,
      snapshot,
      lanPort,
    };
  }

  async join(request: JoinRoomRequest): Promise<SessionHandle> {
    await this.stop();

    const client = new LanClientAdapter({
      address: request.address,
      port: request.port,
      playerName: request.playerName,
      ...(request.playerId !== undefined ? { playerId: request.playerId } : {}),
    });
    this.client = client;
    this.unsubscribe = client.onEvent((event) => this.emit(event));

    const handshake = await client.connect();
    this.localPlayerId = handshake.playerId;

    return {
      playerId: handshake.playerId,
      roomId: handshake.roomId,
      snapshot: handshake.snapshot,
      lanPort: null,
    };
  }

  /** A player-level intent, attributed to whoever this client is. */
  sendIntent(intent: Intent): void {
    if (this.client !== null) {
      this.client.send(intent);
      return;
    }
    this.engine?.dispatch(intent, this.localPlayerId);
  }

  /**
   * A host-privileged intent (start, rules, bots). Refused when this process is
   * a guest — the host is the only authority, and asking nicely over IPC does
   * not change that.
   */
  hostIntent(intent: Intent): void {
    if (this.engine === null) {
      this.emit({
        type: 'ERROR',
        code: 'NOT_HOST',
        message: 'Only the host can change the room',
      });
      return;
    }
    this.engine.dispatch(intent, null);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;

    await this.beacon?.stop();
    this.beacon = null;

    await this.host?.close();
    this.host = null;

    await this.client?.disconnect();
    this.client = null;

    this.engine?.dispose();
    this.engine = null;
    this.localPlayerId = null;
  }
}
