import { normalizeRoomCode, type IRoomCodeResolver, type RoomEndpoint } from '@bombparty/engine';
import type { DiscoveredHostEntry, DiscoveryListener } from './discovery.js';

/**
 * Resolves a room code against LAN beacons.
 *
 * This is the whole LAN half of room-code joining, and it is deliberately
 * boring: hosts already broadcast a beacon every second, the beacon already
 * carries the room's code, so resolving is a table lookup with a wait attached.
 * No new socket, no registry, no cloud.
 *
 * The wait matters. Beacons arrive about once a second, so a player who types
 * a code the instant the app opens would otherwise be told "no such room"
 * purely because discovery had not heard from the host yet. Resolution
 * therefore listens until a beacon shows up or the deadline passes.
 *
 * A relay implementation of `IRoomCodeResolver` would replace this class and
 * nothing else: the code format, protocol, and every caller stay as they are.
 */
export class LanRoomCodeResolver implements IRoomCodeResolver {
  readonly kind = 'lan' as const;

  constructor(private readonly discovery: DiscoveryListener) {}

  async resolve(code: string, timeoutMs = 6_000): Promise<RoomEndpoint | null> {
    const wanted = normalizeRoomCode(code);
    if (wanted === null) return null;

    const found = this.lookup(wanted);
    if (found !== null) return found;

    return new Promise<RoomEndpoint | null>((resolve) => {
      let settled = false;

      const finish = (result: RoomEndpoint | null): void => {
        if (settled) return;
        settled = true;
        off();
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(result);
      };

      const off = this.discovery.onChange(() => {
        const hit = this.lookup(wanted);
        if (hit !== null) finish(hit);
      });

      // The change callback covers the common case; the poll is a backstop for
      // a host whose beacon arrived before this promise was created.
      const poll = setInterval(() => {
        const hit = this.lookup(wanted);
        if (hit !== null) finish(hit);
      }, 250);

      const deadline = setTimeout(() => finish(null), timeoutMs);
    });
  }

  private lookup(code: string): RoomEndpoint | null {
    const entry = this.discovery
      .knownHosts()
      .find((host: DiscoveredHostEntry) => host.beacon.roomCode === code);
    if (entry === undefined) return null;

    return {
      address: entry.address,
      port: entry.beacon.port,
      roomId: entry.beacon.roomId,
      roomCode: entry.beacon.roomCode,
      roomName: entry.beacon.roomName,
    };
  }
}
