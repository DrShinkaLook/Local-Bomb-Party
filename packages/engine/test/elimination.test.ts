import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { COUNTDOWN_MS, EXPLOSION_PAUSE_MS, alivePlayers } from '../src/game/machine.js';
import { asRoomId, type GameEvent, type PlayerId } from '../src/types.js';

/**
 * Elimination and end-of-game tests.
 *
 * All of this is asserted against the authoritative engine state rather than
 * anything the renderer does, because "the game ended" has to be true in the
 * reducer for the UI to have anything correct to show.
 */
const setup = (overrides = {}, playerCount = 2) => {
  const clock = new FakeClock();
  const engine = new GameEngine({
    roomId: asRoomId('room-elim'),
    dictionary: fullDictionary(),
    seed: 'elimination-room',
    clock,
    // Short fuse, one life: every turn ends in an explosion, which is the
    // fastest deterministic route to elimination.
    rules: { minBombMs: 1_000, maxBombMs: 1_000, startingLives: 1, ...overrides },
    tickMs: 50,
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));

  const ids: PlayerId[] = [];
  for (let i = 0; i < playerCount; i += 1) ids.push(engine.addLocalPlayer(`P${i}`));

  engine.dispatch({ type: 'START_GAME' });
  engine.startLoop();
  clock.advance(COUNTDOWN_MS + 60);

  return { engine, clock, events, ids };
};

const livesOf = (engine: GameEngine, id: PlayerId): number =>
  engine.snapshot().players.find((p) => p.id === id)?.lives ?? -1;

describe('Elimination', () => {
  it('eliminates a player when their final life is lost', () => {
    const { engine, clock, events } = setup();
    const phase = engine.snapshot().phase;
    if (phase.name !== 'turn') throw new Error('expected a turn');
    const victim = phase.currentPlayer;

    // Let the fuse run out without answering.
    clock.advance(1_200);

    expect(livesOf(engine, victim)).toBe(0);
    expect(
      events.some((e) => e.type === 'PLAYER_ELIMINATED' && e.playerId === victim),
    ).toBeTruthy();
  });

  it('never gives an eliminated player another turn', () => {
    const { engine, clock } = setup({ startingLives: 1 }, 3);
    const first = engine.snapshot().phase;
    if (first.name !== 'turn') throw new Error('expected a turn');
    const victim = first.currentPlayer;

    clock.advance(1_200 + EXPLOSION_PAUSE_MS + 200);

    // Play on for several more turns; the dead seat must never come up again.
    for (let i = 0; i < 8; i += 1) {
      const p = engine.snapshot().phase;
      if (p.name === 'turn') expect(p.currentPlayer === victim).toBeFalsy();
      if (p.name === 'gameOver') break;
      clock.advance(1_200 + EXPLOSION_PAUSE_MS + 100);
    }
  });

  it('refuses a word from an eliminated player', () => {
    const { engine, clock, events } = setup({ startingLives: 1 }, 3);
    const first = engine.snapshot().phase;
    if (first.name !== 'turn') throw new Error('expected a turn');
    const victim = first.currentPlayer;

    clock.advance(1_200 + EXPLOSION_PAUSE_MS + 200);
    expect(livesOf(engine, victim)).toBe(0);

    const before = engine.snapshot().usedWords.length;
    const errorsBefore = events.filter((e) => e.type === 'ERROR').length;

    engine.dispatch({ type: 'SUBMIT_WORD', playerId: victim, word: 'testing' }, victim);
    clock.advance(60);

    // Nothing they submit is ever accepted.
    expect(engine.snapshot().usedWords.length).toBe(before);
    expect(events.filter((e) => e.type === 'ERROR').length > errorsBefore).toBeTruthy();
  });
});

describe('End of game', () => {
  it('ends with the last player standing as the winner', () => {
    const { engine, clock } = setup({ startingLives: 1 }, 2);

    // Run well past the point where only one player can remain.
    for (let i = 0; i < 10; i += 1) {
      if (engine.snapshot().phase.name === 'gameOver') break;
      clock.advance(1_200 + EXPLOSION_PAUSE_MS + 100);
    }

    const phase = engine.snapshot().phase;
    expect(phase.name).toBe('gameOver');
    if (phase.name !== 'gameOver') throw new Error('expected gameOver');

    const alive = alivePlayers(engine.snapshot());
    expect(alive.length).toBe(1);
    expect(phase.winner).toBe((alive[0] as { id: PlayerId }).id);
  });

  it('emits GAME_OVER exactly once', () => {
    const { engine, clock, events } = setup({ startingLives: 1 }, 2);

    for (let i = 0; i < 20; i += 1) {
      if (engine.snapshot().phase.name === 'gameOver') break;
      clock.advance(1_200 + EXPLOSION_PAUSE_MS + 100);
    }
    // Keep the clock running well past the end.
    clock.advance(30_000);

    expect(events.filter((e) => e.type === 'GAME_OVER').length).toBe(1);
  });

  it('starts no further turn once the game is over', () => {
    const { engine, clock } = setup({ startingLives: 1 }, 2);

    for (let i = 0; i < 20; i += 1) {
      if (engine.snapshot().phase.name === 'gameOver') break;
      clock.advance(1_200 + EXPLOSION_PAUSE_MS + 100);
    }
    expect(engine.snapshot().phase.name).toBe('gameOver');

    const version = engine.snapshot().version;
    clock.advance(60_000);

    // A finished game is inert: no turn, no explosion, no state churn.
    expect(engine.snapshot().phase.name).toBe('gameOver');
    expect(engine.snapshot().version).toBe(version);
  });

  it('queues no bot action after the game is over', () => {
    const clock = new FakeClock();
    const engine = new GameEngine({
      roomId: asRoomId('room-elim-bots'),
      dictionary: fullDictionary(),
      seed: 'elim-bots',
      clock,
      rules: { minBombMs: 1_000, maxBombMs: 1_000, startingLives: 1 },
      tickMs: 50,
    });
    engine.addLocalPlayer('Human');
    engine.addBot('easy');
    engine.dispatch({ type: 'START_GAME' });
    engine.startLoop();
    clock.advance(COUNTDOWN_MS + 60);

    for (let i = 0; i < 20; i += 1) {
      if (engine.snapshot().phase.name === 'gameOver') break;
      clock.advance(1_200 + EXPLOSION_PAUSE_MS + 100);
    }

    if (engine.snapshot().phase.name === 'gameOver') {
      clock.advance(30_000);
      expect(engine.peekPendingBot()).toBeNull();
    }
  });
});

describe('Countdown synchronisation', () => {
  it('starts the first turn at the countdown deadline, not later', () => {
    const clock = new FakeClock();
    const engine = new GameEngine({
      roomId: asRoomId('room-sync'),
      dictionary: fullDictionary(),
      seed: 'sync-room',
      clock,
      rules: { minBombMs: 30_000, maxBombMs: 30_000 },
      tickMs: 50,
    });
    engine.addLocalPlayer('Ana');
    engine.addLocalPlayer('Ben');
    engine.dispatch({ type: 'START_GAME' });
    engine.startLoop();

    const starting = engine.snapshot().phase;
    if (starting.name !== 'starting') throw new Error('expected starting');
    const endsAt = starting.endsAt;

    // One tick before the deadline it must still be counting down.
    clock.advance(COUNTDOWN_MS - 60);
    expect(engine.snapshot().phase.name).toBe('starting');

    // Within a single tick of the deadline the turn is live, so "GO!" and the
    // first turn coincide to within the engine's own resolution.
    clock.advance(60);
    const phase = engine.snapshot().phase;
    expect(phase.name).toBe('turn');
    if (phase.name === 'turn') {
      expect(phase.bombEndsAt - endsAt <= 30_000 + 60).toBeTruthy();
    }
  });
});
