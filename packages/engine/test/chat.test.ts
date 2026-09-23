import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { decodeClientMessage, isValidIntent, PROTOCOL_VERSION } from '../src/net/protocol.js';
import {
  CHAT_HISTORY_LIMIT,
  MAX_CHAT_LENGTH,
  asPlayerId,
  asRoomId,
  type GameEvent,
  type GameRules,
} from '../src/types.js';

const makeRoom = (rules: Partial<GameRules> = {}) => {
  const clock = new FakeClock();
  const engine = new GameEngine({
    roomId: asRoomId('chat-room'),
    dictionary: fullDictionary(),
    seed: 'chat',
    clock,
    rules,
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));

  const ana = asPlayerId('remote-ana');
  const ben = asPlayerId('remote-ben');
  engine.dispatch({ type: 'JOIN', playerId: ana, name: 'Ana' }, ana);
  engine.dispatch({ type: 'JOIN', playerId: ben, name: 'Ben' }, ben);
  events.length = 0;
  return { engine, clock, events, ana, ben };
};

const errorCodes = (events: readonly GameEvent[]): string[] =>
  events.filter((e) => e.type === 'ERROR').map((e) => (e.type === 'ERROR' ? e.code : ''));

describe('Chat', () => {
  it('records an accepted message and announces it', () => {
    const { engine, events, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'hello everyone' }, ana);

    const chat = engine.snapshot().chat;
    expect(chat.length).toBe(1);
    expect(chat[0]?.text).toBe('hello everyone');
    expect(chat[0]?.name).toBe('Ana');
    expect(chat[0]?.playerId).toBe(ana);
    expect(events.some((e) => e.type === 'CHAT_MESSAGE')).toBe(true);
    expect(events.some((e) => e.type === 'STATE_SYNC')).toBe(true);
  });

  it('keeps the author name as it was when sent', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'before' }, ana);
    engine.dispatch({ type: 'RENAME_PLAYER', playerId: ana, name: 'Anastasia' });
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'after' }, ana);

    const chat = engine.snapshot().chat;
    // A rename must not rewrite the transcript, or the log stops matching what
    // people actually saw at the time.
    expect(chat[0]?.name).toBe('Ana');
    expect(chat[1]?.name).toBe('Anastasia');
  });

  it('refuses an empty or whitespace-only message', () => {
    const { engine, events, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: '   ' }, ana);
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: '\n\n\t' }, ana);
    expect(engine.snapshot().chat.length).toBe(0);
    expect(errorCodes(events).filter((c) => c === 'EMPTY_MESSAGE').length).toBe(2);
  });

  it('truncates an over-long message rather than dropping it', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'x'.repeat(5_000) }, ana);
    const chat = engine.snapshot().chat;
    expect(chat.length).toBe(1);
    expect(chat[0]?.text.length).toBe(MAX_CHAT_LENGTH);
  });

  it('collapses whitespace runs so the transcript cannot be stretched', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'a\n\n\n\n\nb     c' }, ana);
    expect(engine.snapshot().chat[0]?.text).toBe('a b c');
  });

  it('bounds the history and drops the oldest first', () => {
    const { engine, ana } = makeRoom();
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 20; i += 1) {
      engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: `m${i}` }, ana);
    }
    const chat = engine.snapshot().chat;
    expect(chat.length).toBe(CHAT_HISTORY_LIMIT);
    expect(chat[0]?.text).toBe('m20');
    expect(chat[chat.length - 1]?.text).toBe(`m${CHAT_HISTORY_LIMIT + 19}`);
  });

  it('keeps ids strictly increasing even after eviction', () => {
    const { engine, ana } = makeRoom();
    for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i += 1) {
      engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: `m${i}` }, ana);
    }
    const chat = engine.snapshot().chat;
    for (let i = 1; i < chat.length; i += 1) {
      expect((chat[i]?.id ?? 0) > (chat[i - 1]?.id ?? 0)).toBe(true);
    }
  });

  it('refuses everything when the host disables chat', () => {
    const { engine, events, ana } = makeRoom({ chatEnabled: false });
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'hello' }, ana);
    expect(engine.snapshot().chat.length).toBe(0);
    expect(errorCodes(events).includes('CHAT_DISABLED')).toBe(true);
  });

  it('refuses a message from someone who is not in the room', () => {
    const { engine, events } = makeRoom();
    const ghost = asPlayerId('ghost');
    engine.dispatch({ type: 'SEND_CHAT', playerId: ghost, text: 'boo' }, ghost);
    expect(engine.snapshot().chat.length).toBe(0);
    expect(errorCodes(events).includes('UNKNOWN_PLAYER')).toBe(true);
  });

  it('refuses a message sent in someone else’s name', () => {
    const { engine, events, ana, ben } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'not me' }, ben);
    expect(engine.snapshot().chat.length).toBe(0);
    expect(errorCodes(events).includes('FORBIDDEN')).toBe(true);
  });

  it('survives a return to the lobby', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'gg' }, ana);
    engine.dispatch({ type: 'START_GAME' });
    engine.dispatch({ type: 'RESET_TO_LOBBY' });
    // Conversation belongs to the room, not to the round.
    expect(engine.snapshot().chat.length).toBe(1);
    expect(engine.snapshot().chat[0]?.text).toBe('gg');
  });

  it('reaches a late joiner through the ordinary snapshot', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SEND_CHAT', playerId: ana, text: 'early' }, ana);

    let handshake: GameEvent | null = null;
    const off = engine.subscribe((e) => {
      if (handshake === null && e.type === 'STATE_SYNC') handshake = e;
    });
    off();
    expect(handshake === null).toBe(false);
    if (handshake !== null && (handshake as GameEvent).type === 'STATE_SYNC') {
      expect((handshake as { snapshot: { chat: readonly { text: string }[] } }).snapshot.chat[0]?.text).toBe('early');
    }
  });
});

describe('Chat over the wire', () => {
  it('accepts a well-formed SEND_CHAT from a client', () => {
    expect(isValidIntent({ type: 'SEND_CHAT', playerId: 'p1', text: 'hi' })).toBe(true);
    const frame = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'INTENT',
      intent: { type: 'SEND_CHAT', playerId: 'p1', text: 'hi' },
    });
    expect(decodeClientMessage(frame)?.type).toBe('INTENT');
  });

  it('refuses an over-long or empty message at the wire', () => {
    expect(isValidIntent({ type: 'SEND_CHAT', playerId: 'p1', text: '' })).toBe(false);
    expect(
      isValidIntent({ type: 'SEND_CHAT', playerId: 'p1', text: 'x'.repeat(MAX_CHAT_LENGTH + 1) }),
    ).toBe(false);
    expect(isValidIntent({ type: 'SEND_CHAT', playerId: 'p1' })).toBe(false);
    expect(isValidIntent({ type: 'SEND_CHAT', text: 'hi' })).toBe(false);
  });
});
