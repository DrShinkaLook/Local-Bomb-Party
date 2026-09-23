import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { Rng } from '../src/util/rng.js';
import { decodeBeacon, PROTOCOL_VERSION } from '../src/net/protocol.js';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isRoomCode,
  normalizeRoomCode,
} from '../src/net/roomCode.js';
import { asRoomId } from '../src/types.js';

describe('Room code alphabet', () => {
  /**
   * These characters are the ones people get wrong reading a code aloud. If
   * any of them ever enters the alphabet, "was that an O or a zero" becomes a
   * support burden that no amount of UI can fix.
   */
  it('excludes every character that is misread out loud', () => {
    for (const ch of ['0', '1', 'O', 'I', 'L', 'U']) {
      expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(false);
    }
  });

  it('has no duplicates', () => {
    expect(new Set([...ROOM_CODE_ALPHABET]).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('is big enough that collisions are not a concern on a LAN', () => {
    expect(Math.pow(ROOM_CODE_ALPHABET.length, ROOM_CODE_LENGTH)).toBeGreaterThan(100_000_000);
  });
});

describe('generateRoomCode', () => {
  it('produces a well-formed code', () => {
    const rng = new Rng('codes');
    for (let i = 0; i < 500; i += 1) {
      const code = generateRoomCode(rng);
      expect(code.length).toBe(ROOM_CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it('is deterministic for a seed and varied across one stream', () => {
    expect(generateRoomCode(new Rng('same'))).toBe(generateRoomCode(new Rng('same')));

    const rng = new Rng('spread');
    const seen = new Set(Array.from({ length: 300 }, () => generateRoomCode(rng)));
    // Not a distribution test, just a guard against a stuck generator.
    expect(seen.size).toBeGreaterThan(290);
  });
});

describe('normalizeRoomCode', () => {
  it('accepts the shapes people actually type', () => {
    expect(normalizeRoomCode('abc234')).toBe('ABC234');
    expect(normalizeRoomCode('ABC-234')).toBe('ABC234');
    expect(normalizeRoomCode('  abc 234  ')).toBe('ABC234');
    expect(normalizeRoomCode('a b c 2 3 4')).toBe('ABC234');
  });

  it('rejects anything that is not a full code', () => {
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('ABC2345')).toBeNull();
    expect(normalizeRoomCode('!!!!!!')).toBeNull();
  });

  /**
   * A misread character is dropped, never guessed at. Mapping O to Q would
   * turn "you typed it wrong" into "you joined the wrong room", which is a
   * far worse failure.
   */
  it('drops ambiguous characters rather than guessing', () => {
    expect(normalizeRoomCode('ABC23O')).toBeNull();
    expect(normalizeRoomCode('ABCI234')).toBe('ABC234');
  });
});

describe('Room code on the room', () => {
  const makeEngine = (seed: string, roomCode?: string) => {
    const clock = new FakeClock();
    return new GameEngine({
      roomId: asRoomId('r'),
      dictionary: fullDictionary(),
      seed,
      clock,
      ...(roomCode !== undefined ? { roomCode } : {}),
    });
  };

  it('gives every room a well-formed code', () => {
    expect(isRoomCode(makeEngine('a').snapshot().roomCode)).toBe(true);
  });

  it('derives the same code from the same seed', () => {
    expect(makeEngine('seeded').snapshot().roomCode).toBe(
      makeEngine('seeded').snapshot().roomCode,
    );
    expect(makeEngine('x').snapshot().roomCode === makeEngine('y').snapshot().roomCode).toBe(false);
  });

  it('lets the host supply a code, for rejoining a known room', () => {
    expect(makeEngine('a', 'ABC234').snapshot().roomCode).toBe('ABC234');
  });

  it('carries the code in the snapshot a client already receives', () => {
    const engine = makeEngine('snap');
    const seen: { value: string | null } = { value: null };
    const off = engine.subscribe((e) => {
      if (e.type === 'STATE_SYNC' && seen.value === null) seen.value = e.snapshot.roomCode;
    });
    off();
    expect(seen.value).toBe(engine.snapshot().roomCode);
  });
});

describe('Beacons carry the code', () => {
  const beacon = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      kind: 'bombparty-host',
      v: PROTOCOL_VERSION,
      roomId: 'r1',
      roomCode: 'ABC234',
      roomName: 'Kitchen table',
      port: 41_234,
      players: 2,
      maxPlayers: 8,
      inProgress: false,
      sentAt: 1,
      ...overrides,
    });

  it('accepts a beacon with a valid code', () => {
    expect(decodeBeacon(beacon())?.roomCode).toBe('ABC234');
  });

  it('rejects a beacon whose code is missing or malformed', () => {
    expect(decodeBeacon(beacon({ roomCode: undefined }))).toBeNull();
    expect(decodeBeacon(beacon({ roomCode: 'ABC' }))).toBeNull();
    expect(decodeBeacon(beacon({ roomCode: 'ABC23O' }))).toBeNull();
    expect(decodeBeacon(beacon({ roomCode: 42 }))).toBeNull();
  });

  /** Unchanged behaviour: the earlier beacon guards still hold. */
  it('still rejects a foreign or mis-versioned beacon', () => {
    expect(decodeBeacon(beacon({ kind: 'something-else' }))).toBeNull();
    expect(decodeBeacon(beacon({ v: 999 }))).toBeNull();
    expect(decodeBeacon('garbage')).toBeNull();
  });
});
