import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { COUNTDOWN_MS } from '../src/game/machine.js';
import { asRoomId, type GameEvent } from '../src/types.js';

const makeEngine = (seed = 'pause-room', overrides = {}) => {
  const clock = new FakeClock();
  const engine = new GameEngine({
    roomId: asRoomId('room-pause'),
    dictionary: fullDictionary(),
    seed,
    clock,
    tickMs: 50,
    rules: { minBombMs: 4_000, maxBombMs: 4_000, startingLives: 2, ...overrides },
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));
  return { engine, clock, events };
};

/** Drive an engine to a live turn, so the fuse is genuinely running. */
const toFirstTurn = (seed = 'pause-room') => {
  const ctx = makeEngine(seed);
  ctx.engine.addLocalPlayer('Ana');
  ctx.engine.addLocalPlayer('Ben');
  ctx.engine.dispatch({ type: 'START_GAME' });
  ctx.engine.startLoop();
  ctx.clock.advance(COUNTDOWN_MS + 100);
  return ctx;
};

const remaining = (engine: GameEngine, clock: FakeClock): number => {
  const phase = engine.snapshot().phase;
  if (phase.name !== 'turn') throw new Error(`expected a turn, got ${phase.name}`);
  return phase.bombEndsAt - clock.now();
};

describe('Pause', () => {
  it('refuses to pause a game that has not started', () => {
    const { engine, events } = makeEngine();
    engine.addLocalPlayer('Ana');
    engine.dispatch({ type: 'PAUSE_GAME' });

    expect(engine.snapshot().pausedAt).toBeNull();
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'NOT_PAUSABLE')).toBeTruthy();
  });

  it('freezes the fuse for exactly as long as the pause lasts', () => {
    const { engine, clock } = toFirstTurn();
    const before = remaining(engine, clock);

    engine.dispatch({ type: 'PAUSE_GAME' });
    clock.advance(10_000);
    engine.dispatch({ type: 'RESUME_GAME' });

    // Ten seconds passed on the wall clock; the fuse did not move at all.
    expect(remaining(engine, clock)).toBe(before);
  });

  it('does not explode while paused, even long past the original deadline', () => {
    const { engine, clock } = toFirstTurn();
    engine.dispatch({ type: 'PAUSE_GAME' });

    // The fuse was 4s. Sit paused for a minute.
    clock.advance(60_000);

    expect(engine.snapshot().phase.name).toBe('turn');
    expect(engine.snapshot().players.every((p) => p.lives === 2)).toBeTruthy();
  });

  it('still explodes once resumed and the remaining fuse runs out', () => {
    const { engine, clock } = toFirstTurn();
    engine.dispatch({ type: 'PAUSE_GAME' });
    clock.advance(30_000);
    engine.dispatch({ type: 'RESUME_GAME' });

    // Burn past the shifted deadline.
    clock.advance(5_000);
    expect(engine.snapshot().players.some((p) => p.lives < 2)).toBeTruthy();
  });

  it('refuses a submitted word while paused', () => {
    const { engine, clock, events } = toFirstTurn();
    const phase = engine.snapshot().phase;
    if (phase.name !== 'turn') throw new Error('expected a turn');
    const active = phase.currentPlayer;

    engine.dispatch({ type: 'PAUSE_GAME' });
    const usedBefore = engine.snapshot().usedWords.length;
    engine.dispatch({ type: 'SUBMIT_WORD', playerId: active, word: 'testing' }, active);
    clock.advance(10);

    expect(engine.snapshot().usedWords.length).toBe(usedBefore);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'GAME_PAUSED')).toBeTruthy();
  });

  it('refuses to resume a game that is not paused', () => {
    const { engine, events } = toFirstTurn();
    engine.dispatch({ type: 'RESUME_GAME' });
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'NOT_PAUSED')).toBeTruthy();
  });

  it('shifts a queued bot answer instead of firing it the moment play resumes', () => {
    const ctx = makeEngine('bot-pause');
    ctx.engine.addLocalPlayer('Ana');
    ctx.engine.addBot('easy');
    ctx.engine.dispatch({ type: 'START_GAME' });
    ctx.engine.startLoop();
    ctx.clock.advance(COUNTDOWN_MS + 100);

    const pending = ctx.engine.peekPendingBot();
    if (pending === null) {
      // Whoever is on the clock first is seed-dependent; only assert when a bot
      // move is actually queued, rather than baking a seed's turn order in.
      return;
    }
    const dueIn = pending.at - ctx.clock.now();

    ctx.engine.dispatch({ type: 'PAUSE_GAME' });
    ctx.clock.advance(20_000);
    ctx.engine.dispatch({ type: 'RESUME_GAME' });

    const after = ctx.engine.peekPendingBot();
    expect(after === null ? -1 : after.at - ctx.clock.now()).toBe(dueIn);
  });

  it('clears the pause when the room resets to the lobby', () => {
    const { engine } = toFirstTurn();
    engine.dispatch({ type: 'PAUSE_GAME' });
    engine.dispatch({ type: 'RESET_TO_LOBBY' });

    expect(engine.snapshot().pausedAt).toBeNull();
    expect(engine.snapshot().phase.name).toBe('lobby');
  });
});

describe('Renaming', () => {
  it('renames a bot in the lobby', () => {
    const { engine } = makeEngine();
    engine.addLocalPlayer('Ana');
    const bot = engine.addBot('easy');

    engine.dispatch({ type: 'RENAME_PLAYER', playerId: bot, name: 'Kobai' });

    const renamed = engine.snapshot().players.find((p) => p.id === bot);
    expect(renamed?.name).toBe('Kobai');
  });

  it('trims and caps an over-long name', () => {
    const { engine } = makeEngine();
    engine.addLocalPlayer('Ana');
    const bot = engine.addBot('easy');

    engine.dispatch({ type: 'RENAME_PLAYER', playerId: bot, name: `   ${'x'.repeat(80)}   ` });

    const renamed = engine.snapshot().players.find((p) => p.id === bot);
    expect(renamed?.name.length).toBe(24);
  });

  it('refuses a blank name rather than creating a nameless seat', () => {
    const { engine, events } = makeEngine();
    engine.addLocalPlayer('Ana');
    const bot = engine.addBot('easy');
    const before = engine.snapshot().players.find((p) => p.id === bot)?.name;

    engine.dispatch({ type: 'RENAME_PLAYER', playerId: bot, name: '   ' });

    expect(engine.snapshot().players.find((p) => p.id === bot)?.name).toBe(before);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'EMPTY_NAME')).toBeTruthy();
  });

  it('refuses to rename once the game is under way', () => {
    const { engine, events } = toFirstTurn();
    const target = engine.snapshot().players[0];
    if (target === undefined) throw new Error('expected a player');

    engine.dispatch({ type: 'RENAME_PLAYER', playerId: target.id, name: 'Sneaky' });

    expect(engine.snapshot().players[0]?.name).toBe(target.name);
    expect(events.some((e) => e.type === 'ERROR' && e.code === 'RENAME_LOCKED')).toBeTruthy();
  });
});
