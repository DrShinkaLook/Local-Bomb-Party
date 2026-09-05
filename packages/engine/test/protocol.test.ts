import { describe, expect, it } from './harness.js';
import {
  PROTOCOL_VERSION,
  decodeBeacon,
  decodeClientMessage,
  encode,
  isValidIntent,
} from '../src/net/protocol.js';
import { asPlayerId } from '../src/types.js';

describe('protocol decoding', () => {
  it('round-trips a well-formed intent', () => {
    const message = encode({
      v: PROTOCOL_VERSION,
      type: 'INTENT',
      intent: { type: 'SUBMIT_WORD', playerId: asPlayerId('p1'), word: 'string' },
    });
    const decoded = decodeClientMessage(message);
    expect(decoded === null).toBe(false);
    expect(decoded?.type).toBe('INTENT');
  });

  it('refuses a mismatched protocol version', () => {
    expect(decodeClientMessage(JSON.stringify({ v: 999, type: 'PING', t: 1 }))).toBeNull();
  });

  it('refuses malformed JSON without throwing', () => {
    expect(decodeClientMessage('{not json')).toBeNull();
    expect(decodeClientMessage('')).toBeNull();
    expect(decodeClientMessage('null')).toBeNull();
    expect(decodeClientMessage('[]')).toBeNull();
  });

  it('refuses privileged intents arriving from the wire', () => {
    for (const intent of [
      { type: 'START_GAME' },
      { type: 'SET_RULES', rules: { startingLives: 99 } },
      { type: 'ADD_BOT', difficulty: 'impossible' },
      { type: 'REMOVE_PLAYER', playerId: 'victim' },
    ]) {
      expect(isValidIntent(intent)).toBe(false);
      expect(
        decodeClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'INTENT', intent })),
      ).toBeNull();
    }
  });

  it('bounds attacker-controlled string lengths', () => {
    const huge = 'a'.repeat(5_000);
    expect(isValidIntent({ type: 'SUBMIT_WORD', playerId: 'p1', word: huge })).toBe(false);
    expect(isValidIntent({ type: 'TYPING', playerId: 'p1', text: huge })).toBe(false);
    expect(
      decodeClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'HELLO', name: huge })),
    ).toBeNull();
  });

  it('accepts a HELLO with and without a reconnect id', () => {
    const plain = decodeClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'HELLO', name: 'Ana' }),
    );
    expect(plain?.type).toBe('HELLO');

    const reconnect = decodeClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'HELLO', name: 'Ana', playerId: 'p1' }),
    );
    expect(reconnect?.type).toBe('HELLO');
  });

  it('validates discovery beacons', () => {
    const good = JSON.stringify({
      kind: 'bombparty-host',
      v: PROTOCOL_VERSION,
      roomId: 'r1',
      roomName: 'Kitchen table',
      port: 41234,
      players: 2,
      maxPlayers: 8,
      inProgress: false,
      sentAt: 1,
    });
    expect(decodeBeacon(good)?.port).toBe(41234);
    expect(decodeBeacon(JSON.stringify({ kind: 'something-else', v: 1 }))).toBeNull();
    expect(decodeBeacon('garbage')).toBeNull();
  });
});
