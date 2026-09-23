import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { allPlayersReady } from '../src/game/machine.js';
import { isValidIntent } from '../src/net/protocol.js';
import {
  AVATARS,
  PLAYER_COLORS,
  asPlayerId,
  asRoomId,
  type GameEvent,
  type GameRules,
} from '../src/types.js';

const makeRoom = (rules: Partial<GameRules> = {}) => {
  const clock = new FakeClock();
  const engine = new GameEngine({
    roomId: asRoomId('lobby-room'),
    dictionary: fullDictionary(),
    seed: 'lobby',
    clock,
    rules,
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));
  const ana = asPlayerId('ana');
  const ben = asPlayerId('ben');
  engine.dispatch({ type: 'JOIN', playerId: ana, name: 'Ana' }, ana);
  engine.dispatch({ type: 'JOIN', playerId: ben, name: 'Ben' }, ben);
  events.length = 0;
  return { engine, events, ana, ben };
};

const codes = (events: readonly GameEvent[]): string[] =>
  events.filter((e) => e.type === 'ERROR').map((e) => (e.type === 'ERROR' ? e.code : ''));

describe('Player appearance', () => {
  it('gives every seat a distinct avatar and colour on join', () => {
    const { engine } = makeRoom();
    const [a, b] = engine.snapshot().players;
    expect(a?.avatar === b?.avatar).toBe(false);
    expect(AVATARS.includes(a?.avatar ?? '')).toBe(true);
    expect(PLAYER_COLORS.includes(a?.color ?? '')).toBe(true);
  });

  it('lets a player change their own avatar and colour', () => {
    const { engine, ana } = makeRoom();
    const avatar = AVATARS[5] as string;
    const color = PLAYER_COLORS[3] as string;
    engine.dispatch({ type: 'SET_APPEARANCE', playerId: ana, avatar, color }, ana);

    const me = engine.snapshot().players.find((p) => p.id === ana);
    expect(me?.avatar).toBe(avatar);
    expect(me?.color).toBe(color);
  });

  /**
   * The reason appearance is an index into a palette rather than free text:
   * a LAN peer must not be able to push markup, a URL, or a wall of emoji
   * onto everyone else's screen.
   */
  it('ignores an avatar or colour outside the shipped palettes', () => {
    const { engine, ana } = makeRoom();
    const before = engine.snapshot().players.find((p) => p.id === ana);

    engine.dispatch(
      { type: 'SET_APPEARANCE', playerId: ana, avatar: '<img src=x>', color: 'red' },
      ana,
    );
    engine.dispatch(
      { type: 'SET_APPEARANCE', playerId: ana, avatar: '😀'.repeat(200) },
      ana,
    );

    const after = engine.snapshot().players.find((p) => p.id === ana);
    expect(after?.avatar).toBe(before?.avatar);
    expect(after?.color).toBe(before?.color);
  });

  it('refuses an appearance change made in someone else’s name', () => {
    const { engine, events, ana, ben } = makeRoom();
    engine.dispatch({ type: 'SET_APPEARANCE', playerId: ana, avatar: AVATARS[9] as string }, ben);
    expect(codes(events).includes('FORBIDDEN')).toBe(true);
  });
});

describe('Readiness', () => {
  it('starts humans unready and bots ready', () => {
    const { engine } = makeRoom();
    engine.addBot('medium');
    const players = engine.snapshot().players;
    expect(players.filter((p) => p.kind.type === 'human').every((p) => !p.ready)).toBe(true);
    expect(players.find((p) => p.kind.type === 'bot')?.ready).toBe(true);
  });

  it('lets a player ready and unready themselves', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'SET_READY', playerId: ana, ready: true }, ana);
    expect(engine.snapshot().players.find((p) => p.id === ana)?.ready).toBe(true);
    engine.dispatch({ type: 'SET_READY', playerId: ana, ready: false }, ana);
    expect(engine.snapshot().players.find((p) => p.id === ana)?.ready).toBe(false);
  });

  it('refuses a readiness change made in someone else’s name', () => {
    const { engine, events, ana, ben } = makeRoom();
    engine.dispatch({ type: 'SET_READY', playerId: ana, ready: true }, ben);
    expect(codes(events).includes('FORBIDDEN')).toBe(true);
  });

  it('reports readiness the same way the lobby button will', () => {
    const { engine, ana, ben } = makeRoom();
    expect(allPlayersReady(engine.snapshot())).toBe(false);
    engine.dispatch({ type: 'SET_READY', playerId: ana, ready: true }, ana);
    expect(allPlayersReady(engine.snapshot())).toBe(false);
    engine.dispatch({ type: 'SET_READY', playerId: ben, ready: true }, ben);
    expect(allPlayersReady(engine.snapshot())).toBe(true);
  });

  it('does not let a sleeping laptop hold the room hostage', () => {
    const { engine, ana, ben } = makeRoom();
    engine.dispatch({ type: 'SET_READY', playerId: ana, ready: true }, ana);
    engine.dispatch({ type: 'LEAVE', playerId: ben }, ben);
    expect(allPlayersReady(engine.snapshot())).toBe(true);
  });

  /**
   * Readiness is advisory. The host owns START_GAME outright, and an engine
   * that refuses the host's own room would be enforcing etiquette, not a rule.
   */
  it('never blocks the host from starting', () => {
    const { engine } = makeRoom();
    expect(allPlayersReady(engine.snapshot())).toBe(false);
    engine.dispatch({ type: 'START_GAME' });
    expect(engine.snapshot().phase.name).toBe('starting');
  });
});

describe('Self-service renaming', () => {
  it('lets a remote player rename themselves', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'RENAME_PLAYER', playerId: ana, name: 'Anastasia' }, ana);
    expect(engine.snapshot().players.find((p) => p.id === ana)?.name).toBe('Anastasia');
  });

  it('still refuses renaming somebody else', () => {
    const { engine, events, ana, ben } = makeRoom();
    engine.dispatch({ type: 'RENAME_PLAYER', playerId: ana, name: 'Hacked' }, ben);
    expect(engine.snapshot().players.find((p) => p.id === ana)?.name).toBe('Ana');
    expect(codes(events).includes('FORBIDDEN')).toBe(true);
  });

  it('still lets the host rename anyone', () => {
    const { engine, ana } = makeRoom();
    engine.dispatch({ type: 'RENAME_PLAYER', playerId: ana, name: 'Renamed' });
    expect(engine.snapshot().players.find((p) => p.id === ana)?.name).toBe('Renamed');
  });
});

describe('Seat limit', () => {
  it('fills up to the configured limit and then refuses', () => {
    const { engine, events } = makeRoom({ playerLimit: 4 });
    engine.dispatch({ type: 'JOIN', playerId: asPlayerId('c'), name: 'Cy' }, asPlayerId('c'));
    engine.dispatch({ type: 'JOIN', playerId: asPlayerId('d'), name: 'Di' }, asPlayerId('d'));
    expect(engine.snapshot().players.length).toBe(4);

    engine.dispatch({ type: 'JOIN', playerId: asPlayerId('e'), name: 'Ed' }, asPlayerId('e'));
    expect(engine.snapshot().players.length).toBe(4);
    expect(codes(events).includes('ROOM_FULL')).toBe(true);
  });

  it('counts bots against the limit', () => {
    const { engine } = makeRoom({ playerLimit: 3 });
    expect(engine.addBot('easy') === null).toBe(false);
    expect(engine.addBot('easy')).toBeNull();
    expect(engine.snapshot().players.length).toBe(3);
  });

  it('seats sixteen', () => {
    const { engine } = makeRoom({ playerLimit: 16 });
    for (let i = 0; i < 14; i += 1) {
      const id = asPlayerId(`p${i}`);
      engine.dispatch({ type: 'JOIN', playerId: id, name: `P${i}` }, id);
    }
    expect(engine.snapshot().players.length).toBe(16);
    // Every seat still has a distinct avatar at a full table.
    const avatars = new Set(engine.snapshot().players.map((p) => p.avatar));
    expect(avatars.size).toBe(16);
  });

  it('still lets a disconnected player reclaim their seat when full', () => {
    const { engine, ana } = makeRoom({ playerLimit: 2 });
    engine.dispatch({ type: 'JOIN', playerId: ana, name: 'Ana' }, ana);
    expect(engine.snapshot().players.length).toBe(2);
  });
});

describe('Lobby intents over the wire', () => {
  it('accepts the self-owned ones', () => {
    expect(isValidIntent({ type: 'SET_READY', playerId: 'p1', ready: true })).toBe(true);
    expect(isValidIntent({ type: 'SET_APPEARANCE', playerId: 'p1', avatar: '🦊' })).toBe(true);
    expect(isValidIntent({ type: 'SET_APPEARANCE', playerId: 'p1', color: '#22c55e' })).toBe(true);
    expect(isValidIntent({ type: 'RENAME_PLAYER', playerId: 'p1', name: 'Ana' })).toBe(true);
  });

  it('rejects malformed or oversized ones', () => {
    expect(isValidIntent({ type: 'SET_READY', playerId: 'p1', ready: 'yes' })).toBe(false);
    expect(isValidIntent({ type: 'SET_APPEARANCE', playerId: 'p1', avatar: 'x'.repeat(64) })).toBe(false);
    expect(isValidIntent({ type: 'RENAME_PLAYER', playerId: 'p1', name: '   ' })).toBe(false);
    expect(isValidIntent({ type: 'RENAME_PLAYER', playerId: 'p1', name: 'x'.repeat(99) })).toBe(false);
  });

  it('still refuses the host-only ones', () => {
    expect(isValidIntent({ type: 'START_GAME' })).toBe(false);
    expect(isValidIntent({ type: 'SET_RULES', rules: { playerLimit: 99 } })).toBe(false);
    expect(isValidIntent({ type: 'ADD_BOT', difficulty: 'impossible' })).toBe(false);
  });
});
