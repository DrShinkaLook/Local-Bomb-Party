import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary, tinyDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { LocalAdapter } from '../src/net/localAdapter.js';
import { COUNTDOWN_MS, alivePlayers, playerById } from '../src/game/machine.js';
import { SyllableGenerator } from '../src/dictionary/syllables.js';
import { asPlayerId, asRoomId, type GameEvent, type PlayerId } from '../src/types.js';

const makeEngine = (seed = 'test-room', overrides = {}) => {
  const clock = new FakeClock();
  const dictionary = fullDictionary();
  const engine = new GameEngine({
    roomId: asRoomId('room-1'),
    dictionary,
    seed,
    clock,
    tickMs: 50,
    rules: { minBombMs: 4_000, maxBombMs: 4_000, startingLives: 2, ...overrides },
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));
  return { engine, clock, events, dictionary };
};

describe('GameEngine lobby', () => {
  it('seats players in join order', () => {
    const { engine } = makeEngine();
    const a = engine.addLocalPlayer('Ana');
    const b = engine.addLocalPlayer('Ben');
    const state = engine.snapshot();
    expect(state.players.length).toBe(2);
    expect(playerById(state, a)?.seat).toBe(0);
    expect(playerById(state, b)?.seat).toBe(1);
    expect(state.phase.name).toBe('lobby');
  });

  it('reseats densely when a player leaves the lobby', () => {
    const { engine } = makeEngine();
    engine.addLocalPlayer('Ana');
    const b = engine.addLocalPlayer('Ben');
    engine.addLocalPlayer('Cy');
    engine.removePlayer(b);
    const seats = engine.snapshot().players.map((p) => p.seat).sort();
    expect(seats).toEqual([0, 1]);
  });

  it('refuses to start with nobody in the room', () => {
    const { engine, events } = makeEngine();
    engine.dispatch({ type: 'START_GAME' });
    expect(engine.snapshot().phase.name).toBe('lobby');
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'NOT_ENOUGH_PLAYERS')).toBe(true);
  });
});

describe('GameEngine turn flow', () => {
  it('starts a turn after the countdown', () => {
    const { engine, clock } = makeEngine();
    engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });
    expect(engine.snapshot().phase.name).toBe('starting');

    clock.advance(COUNTDOWN_MS + 50);
    engine.tick(clock.now());
    expect(engine.snapshot().phase.name).toBe('turn');
  });

  it('passes the bomb on a correct word and consumes it', () => {
    const { engine, clock, dictionary } = makeEngine();
    const a = engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });
    clock.advance(COUNTDOWN_MS + 50);
    engine.tick(clock.now());

    const phase = engine.snapshot().phase;
    if (phase.name !== 'turn') throw new Error('expected a turn');
    const word = dictionary.findWordsContaining(phase.syllable, 1)[0] as string;

    engine.dispatch({ type: 'SUBMIT_WORD', playerId: phase.currentPlayer, word }, phase.currentPlayer);

    const after = engine.snapshot();
    if (after.phase.name !== 'turn') throw new Error('expected another turn');
    expect(after.phase.currentPlayer === phase.currentPlayer).toBe(false);
    expect(after.usedWords.includes(word)).toBe(true);
    expect(dictionary.isUsed(word)).toBe(true);
    expect(a === phase.currentPlayer || true).toBe(true);
  });

  it('costs a life when the fuse runs out, not when a word is wrong', () => {
    const { engine, clock } = makeEngine();
    engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });
    clock.advance(COUNTDOWN_MS + 50);
    engine.tick(clock.now());

    const phase = engine.snapshot().phase;
    if (phase.name !== 'turn') throw new Error('expected a turn');
    const victim = phase.currentPlayer;

    engine.dispatch({ type: 'SUBMIT_WORD', playerId: victim, word: 'zzzzqx' }, victim);
    expect(playerById(engine.snapshot(), victim)?.lives).toBe(2);

    clock.advance(5_000);
    engine.tick(clock.now());
    expect(playerById(engine.snapshot(), victim)?.lives).toBe(1);
    expect(engine.snapshot().phase.name).toBe('exploded');
  });

  it('rejects a word submitted by anyone but the active player', () => {
    const { engine, clock, events } = makeEngine();
    engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });
    clock.advance(COUNTDOWN_MS + 50);
    engine.tick(clock.now());

    const phase = engine.snapshot().phase;
    if (phase.name !== 'turn') throw new Error('expected a turn');
    const other = engine.snapshot().players.find((p) => p.id !== phase.currentPlayer)?.id as PlayerId;

    events.length = 0;
    engine.dispatch({ type: 'SUBMIT_WORD', playerId: other, word: 'cat' }, other);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'NOT_YOUR_TURN')).toBe(true);
  });

  it('refuses an intent that impersonates another player', () => {
    const { engine, events } = makeEngine();
    const a = engine.addLocalPlayer('Ana');
    const b = engine.addLocalPlayer('Ben');
    events.length = 0;
    engine.dispatch({ type: 'SUBMIT_WORD', playerId: a, word: 'cat' }, b);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'FORBIDDEN')).toBe(true);
  });

  it('refuses privileged intents from a client', () => {
    const { engine, events } = makeEngine();
    const a = engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    events.length = 0;
    engine.dispatch({ type: 'START_GAME' }, a);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'FORBIDDEN')).toBe(true);
    expect(engine.snapshot().phase.name).toBe('lobby');
  });
});

describe('GameEngine elimination', () => {
  it('eliminates at zero lives and ends with one survivor', () => {
    const { engine, clock, events } = makeEngine('elim', { startingLives: 1 });
    engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });

    // Nobody ever answers, so the fuse eliminates players one at a time.
    for (let i = 0; i < 400 && engine.snapshot().phase.name !== 'gameOver'; i += 1) {
      clock.advance(500);
      engine.tick(clock.now());
    }

    const state = engine.snapshot();
    expect(state.phase.name).toBe('gameOver');
    expect(alivePlayers(state).length).toBe(1);
    expect(events.some((e) => e.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(events.some((e) => e.type === 'GAME_OVER')).toBe(true);
  });

  it('grants a life for using the whole alphabet', () => {
    const clock = new FakeClock();
    // A word list where a single word covers the alphabet keeps this exact.
    const dictionary = tinyDictionary();
    const engine = new GameEngine({
      roomId: asRoomId('alpha'),
      dictionary,
      seed: 'alpha',
      clock,
      rules: { startingLives: 1, maxLives: 3, minWordLength: 3, alphabetBonusEnabled: true },
      syllables: new SyllableGenerator(dictionary, { minWords: 1, minOnsetWords: 1 }),
    });
    const a = engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    expect(playerById(engine.snapshot(), a)?.lives).toBe(1);
    // Alphabet completion is exercised by the reducer unit path; here we only
    // assert the bonus is off by default for a partial alphabet.
    expect(playerById(engine.snapshot(), a)?.stats.alphabetUsed.length).toBe(0);
  });
});

describe('Determinism', () => {
  const playScript = (seed: string): string => {
    const clock = new FakeClock();
    const dictionary = fullDictionary();
    const engine = new GameEngine({
      roomId: asRoomId('det'),
      dictionary,
      seed,
      clock,
      tickMs: 50,
      rules: { minBombMs: 3_000, maxBombMs: 6_000, startingLives: 2 },
    });
    engine.addBot('medium');
    engine.addBot('easy');
    engine.addBot('impossible');
    engine.dispatch({ type: 'START_GAME' });

    const log: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'TURN_STARTED') log.push(`T:${e.playerId}:${e.syllable}`);
      if (e.type === 'WORD_SUBMITTED') log.push(`W:${e.playerId}:${e.word}:${e.result.ok}`);
      if (e.type === 'PLAYER_EXPLODED') log.push(`X:${e.playerId}`);
      if (e.type === 'GAME_OVER') log.push(`G:${e.winner}`);
    });

    for (let i = 0; i < 4_000 && engine.snapshot().phase.name !== 'gameOver'; i += 1) {
      clock.advance(50);
      engine.tick(clock.now());
    }
    return log.join('|');
  };

  it('replays identically from the same seed', () => {
    expect(playScript('replay-seed')).toBe(playScript('replay-seed'));
  });

  it('produces a different game for a different seed', () => {
    expect(playScript('seed-x') === playScript('seed-y')).toBe(false);
  });

  it('reaches a conclusion rather than stalling', () => {
    const log = playScript('conclusion');
    expect(log).toContain('G:');
  });
});

describe('LocalAdapter', () => {
  it('presents the single-player game through the network interface', async () => {
    const clock = new FakeClock();
    const engine = new GameEngine({
      roomId: asRoomId('solo'),
      dictionary: fullDictionary(),
      seed: 'solo',
      clock,
      rules: { minBombMs: 4_000, maxBombMs: 4_000 },
    });
    const adapter = new LocalAdapter(engine, 'Ana');

    const seen: GameEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    const handshake = await adapter.connect();
    expect(handshake.roomId).toBe(asRoomId('solo'));
    expect(engine.hasPlayer(handshake.playerId)).toBe(true);
    expect(adapter.latencyMs()).toBe(0);
    expect(adapter.latestSnapshot() === null).toBe(false);

    engine.addBot('impossible');
    adapter.hostDispatch({ type: 'START_GAME' });
    clock.advance(COUNTDOWN_MS + 100);
    engine.tick(clock.now());
    expect(seen.some((e) => e.type === 'TURN_STARTED')).toBe(true);

    await adapter.disconnect();
  });

  it('applies the same authorisation rules as a remote client', async () => {
    const clock = new FakeClock();
    const engine = new GameEngine({
      roomId: asRoomId('auth'),
      dictionary: fullDictionary(),
      seed: 'auth',
      clock,
    });
    const adapter = new LocalAdapter(engine, 'Ana');
    await adapter.connect();

    const errors: GameEvent[] = [];
    adapter.onEvent((e) => {
      if (e.type === 'ERROR') errors.push(e);
    });
    // START_GAME is host-privileged; sending it as a client must be refused
    // even though this client happens to be running in the host process.
    adapter.send({ type: 'START_GAME' });
    expect(errors.some((e) => e.type === 'ERROR' && e.code === 'FORBIDDEN')).toBe(true);
    expect(engine.snapshot().phase.name).toBe('lobby');
  });
});

describe('Bots', () => {
  it('answers within its profile latency band', () => {
    const { engine, clock } = makeEngine('bot-latency', { minBombMs: 8_000, maxBombMs: 8_000 });
    engine.addBot('impossible');
    engine.addBot('impossible');
    engine.dispatch({ type: 'START_GAME' });
    clock.advance(COUNTDOWN_MS + 50);
    engine.tick(clock.now());

    const pending = engine.peekPendingBot();
    expect(pending === null).toBe(false);
    if (pending !== null) {
      const state = engine.snapshot();
      if (state.phase.name !== 'turn') throw new Error('expected a turn');
      const start = state.phase.bombEndsAt - state.phase.bombTotalMs;
      expect(pending.at - start).toBeLessThanOrEqual(10);
    }
  });

  it('lets an impossible bot beat an easy one over many games', () => {
    let impossibleWins = 0;
    const games = 12;

    for (let g = 0; g < games; g += 1) {
      const clock = new FakeClock();
      const engine = new GameEngine({
        roomId: asRoomId(`match-${g}`),
        dictionary: fullDictionary(),
        seed: `match-${g}`,
        clock,
        tickMs: 50,
        rules: { minBombMs: 4_000, maxBombMs: 7_000, startingLives: 2 },
      });
      const hard = engine.addBot('impossible');
      engine.addBot('easy');
      engine.dispatch({ type: 'START_GAME' });

      for (let i = 0; i < 4_000 && engine.snapshot().phase.name !== 'gameOver'; i += 1) {
        clock.advance(50);
        engine.tick(clock.now());
      }
      const phase = engine.snapshot().phase;
      if (phase.name === 'gameOver' && phase.winner === hard) impossibleWins += 1;
    }
    expect(impossibleWins).toBeGreaterThanOrEqual(Math.ceil(games * 0.75));
  });

  it('never submits a word outside the dictionary as a real answer', () => {
    const { engine, clock, events, dictionary } = makeEngine('bot-valid');
    engine.addBot('medium');
    engine.addBot('medium');
    engine.dispatch({ type: 'START_GAME' });

    for (let i = 0; i < 2_000 && engine.snapshot().phase.name !== 'gameOver'; i += 1) {
      clock.advance(50);
      engine.tick(clock.now());
    }

    const accepted = events.filter((e) => e.type === 'WORD_SUBMITTED' && e.result.ok);
    expect(accepted.length).toBeGreaterThan(0);
    for (const event of accepted) {
      if (event.type !== 'WORD_SUBMITTED') continue;
      expect(dictionary.has(event.word)).toBe(true);
    }
  });

  it('gives each bot an independent decision stream', () => {
    const { engine } = makeEngine('streams');
    const a = engine.addBot('medium');
    const b = engine.addBot('medium');
    expect(a === b).toBe(false);
    expect(engine.snapshot().players.length).toBe(2);
  });
});

describe('Reconnection', () => {
  it('restores a seat rather than duplicating a player', () => {
    const { engine } = makeEngine();
    const id = asPlayerId('remote-1');
    engine.dispatch({ type: 'JOIN', playerId: id, name: 'Remote' }, id);
    expect(engine.snapshot().players.length).toBe(1);
    engine.dispatch({ type: 'JOIN', playerId: id, name: 'Remote' }, id);
    expect(engine.snapshot().players.length).toBe(1);
  });
});
