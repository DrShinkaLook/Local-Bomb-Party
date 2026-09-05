import dgram from 'node:dgram';
import { decodeBeacon, type DiscoveryBeacon } from '@bombparty/engine';

/**
 * LAN host discovery over UDP broadcast.
 *
 * Hosts shout a small JSON beacon to the broadcast address once a second;
 * clients listen and keep a table of hosts seen recently. No central registry,
 * no mDNS dependency, no configuration — a player on the same subnet opens the
 * lobby browser and the room is there.
 *
 * Beacons are advisory only. Nothing about game state travels this way, and a
 * forged beacon can do no more than advertise a room that will refuse the
 * connection.
 */

export const DISCOVERY_PORT = 41_234;
const BEACON_INTERVAL_MS = 1_000;
const HOST_TIMEOUT_MS = 4_000;

export interface DiscoveredHostEntry {
  readonly beacon: DiscoveryBeacon;
  readonly address: string;
  readonly lastSeen: number;
}

export class DiscoveryBroadcaster {
  private socket: dgram.Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly describe: () => DiscoveryBeacon) {}

  async start(): Promise<void> {
    if (this.socket !== null) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => {
        socket.setBroadcast(true);
        socket.removeListener('error', reject);
        resolve();
      });
    });

    this.timer = setInterval(() => this.pulse(), BEACON_INTERVAL_MS);
    this.pulse();
  }

  private pulse(): void {
    if (this.socket === null) return;
    const payload = Buffer.from(JSON.stringify(this.describe()));
    // Errors here are routine on machines with odd interface configurations
    // (a VPN adapter that refuses broadcast, for example). A failed beacon
    // must never take down the room, so it is swallowed deliberately.
    this.socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}

export class DiscoveryListener {
  private socket: dgram.Socket | null = null;
  private readonly hosts = new Map<string, DiscoveredHostEntry>();
  private readonly listeners = new Set<(hosts: readonly DiscoveredHostEntry[]) => void>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.socket !== null) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    socket.on('message', (payload, remote) => {
      const beacon = decodeBeacon(payload.toString('utf8'));
      if (beacon === null) return;
      this.hosts.set(`${remote.address}:${beacon.port}`, {
        beacon,
        address: remote.address,
        lastSeen: Date.now(),
      });
      this.notify();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(DISCOVERY_PORT, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    this.sweeper = setInterval(() => this.sweep(), 1_000);
  }

  private sweep(): void {
    const cutoff = Date.now() - HOST_TIMEOUT_MS;
    let changed = false;
    for (const [key, entry] of this.hosts) {
      if (entry.lastSeen < cutoff) {
        this.hosts.delete(key);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private notify(): void {
    const snapshot = this.knownHosts();
    for (const listener of this.listeners) listener(snapshot);
  }

  onChange(listener: (hosts: readonly DiscoveredHostEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  knownHosts(): readonly DiscoveredHostEntry[] {
    return Array.from(this.hosts.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async stop(): Promise<void> {
    if (this.sweeper !== null) clearInterval(this.sweeper);
    this.sweeper = null;
    const socket = this.socket;
    this.socket = null;
    this.hosts.clear();
    if (socket === null) return;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }
}
