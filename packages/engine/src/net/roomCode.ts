import type { Rng } from '../util/rng.js';

/**
 * Room codes.
 *
 * A code is an **opaque token**, not an encoded address. That is the whole
 * design decision, and it is the one that decides whether internet play is a
 * small change or a rewrite.
 *
 * The tempting shortcut on a LAN is to pack the host's IP and port into the
 * code — six bytes, no infrastructure, resolves instantly and offline. It also
 * cannot survive contact with a relay server, because an internet room has no
 * LAN address to encode, so the entire scheme would have to be thrown away the
 * day the game leaves the subnet.
 *
 * So the code carries no routing information at all. Turning a code into
 * somewhere to connect is the job of an `IRoomCodeResolver`: today the LAN one
 * matches it against UDP beacons already being broadcast, tomorrow a relay one
 * asks a server. The code, the UI, the protocol and the engine do not change
 * when that swap happens.
 *
 * The alphabet excludes 0, 1, O, I, L and U: the first five because they are
 * misread when someone says a code out loud across a room, and U because
 * removing it makes accidental words far less likely. Thirty characters over
 * six positions is about 729 million codes, which is ample when the collision
 * domain is one house.
 */

export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;

/** Deterministic given the RNG, so a seeded room reproduces its own code. */
export const generateRoomCode = (rng: Rng): string => {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[rng.int(ROOM_CODE_ALPHABET.length)] as string;
  }
  return code;
};

/**
 * Clean up what a person typed.
 *
 * Accepts lower case, spaces and hyphens, because "abc-123" is how people
 * write a code down. Characters outside the alphabet are dropped rather than
 * guessed at: since the ambiguous ones are never generated, someone typing an
 * O or an I has misread something, and silently mapping it to a neighbour
 * would turn a clear failure into a wrong room.
 *
 * Returns null when the result is not a usable code.
 */
export const normalizeRoomCode = (input: string): string | null => {
  let cleaned = '';
  for (const ch of input.toUpperCase()) {
    if (ROOM_CODE_ALPHABET.includes(ch)) cleaned += ch;
  }
  return cleaned.length === ROOM_CODE_LENGTH ? cleaned : null;
};

/** Whether a value is already a well-formed code. */
export const isRoomCode = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === ROOM_CODE_LENGTH &&
  [...value].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
