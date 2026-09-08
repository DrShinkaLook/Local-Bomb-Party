import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { GameEngine } from '../src/game/engine.js';
import { COUNTDOWN_MS, requiredAlphabet } from '../src/game/machine.js';
import type { Dictionary } from '../src/dictionary/dictionary.js';
import { DEFAULT_RULES, asRoomId, type GameEvent, type PlayerId } from '../src/types.js';

/**
 * Alphabet-bonus tests.
 *
 * These drive the real engine rather than the reducer alone, because the
 * guarantee under test is "exactly once per completed cycle" — and the things
 * that could plausibly break it (the tick loop, event fan-out, snapshot
 * rebroadcast) only exist at the engine level.
 *
 * Most tests use a one-letter requirement. Spelling all 26 letters would take
 * dozens of turns and make the assertions depend on dictionary contents; a
 * single required letter exercises the identical code path — collect, complete,
 * reward, reset — while staying exact.
 */
const setup = (overrides = {}) => {
  const clock = new FakeClock();
  const dict = fullDictionary();
  const engine = new GameEngine({
    roomId: asRoomId('room-abc'),
    dictionary: dict,
    seed: 'alphabet-room',
    clock,
    // A very long fuse: these tests are about submissions, never about the bomb.
    rules: { minBombMs: 600_000, maxBombMs: 600_000, startingLives: 2, ...overrides },
    tickMs: 50,
  });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));

  const a = engine.addLocalPlayer('Ana');
  const b = engine.addLocalPlayer('Ben');
  engine.dispatch({ type: 'START_GAME' });
  engine.startLoop();
  clock.advance(COUNTDOWN_MS + 100);

  return { engine, clock, events, dict, a, b };
};

const turn = (engine: GameEngine) => {
  const phase = engine.snapshot().phase;
  if (phase.name !== 'turn') throw new Error(`expected a turn, got ${phase.name}`);
  return phase;
};

const statsOf = (engine: GameEngine, id: PlayerId) =>
  engine.snapshot().players.find((p) => p.id === id);

const lettersOf = (engine: GameEngine, id: PlayerId): readonly string[] =>
  statsOf(engine, id)?.stats.alphabetUsed ?? [];

const livesOf = (engine: GameEngine, id: PlayerId): number => statsOf(engine, id)?.lives ?? -1;

/**
 * Submit a word the dictionary genuinely accepts for the live syllable,
 * preferring one that contains `mustContain`. Returns the word played.
 */
const playWord = (
  engine: GameEngine,
  clock: FakeClock,
  dict: Dictionary,
  mustContain?: string,
): string => {
  const { currentPlayer, syllable } = turn(engine);
  const used = new Set(engine.snapshot().usedWords);
  const candidates = dict
    .findWordsContaining(syllable)
    .filter((w) => w.length >= 3 && !used.has(w));

  const word =
    (mustContain !== undefined ? candidates.find((w) => w.includes(mustContain)) : undefined) ??
    candidates[0];
  if (word === undefined) throw new Error(`no candidate word for syllable "${syllable}"`);

  engine.dispatch({ type: 'SUBMIT_WORD', playerId: currentPlayer, word }, currentPlayer);
  clock.advance(60);
  return word;
};

describe('Alphabet bonus — tracking', () => {
  it('marks every unique letter of an accepted word', () => {
    const { engine, clock, dict } = setup();
    const id = turn(engine).currentPlayer;

    const word = playWord(engine, clock, dict);

    const marked = lettersOf(engine, id);
    for (const ch of new Set(word)) expect(marked.includes(ch)).toBeTruthy();
    expect(marked.length).toBe(new Set(word).size);
  });

  it('does not mark letters for a rejected word', () => {
    const { engine, clock } = setup();
    const id = turn(engine).currentPlayer;

    engine.dispatch({ type: 'SUBMIT_WORD', playerId: id, word: 'zzzzqqqq' }, id);
    clock.advance(60);

    expect(lettersOf(engine, id).length).toBe(0);
    expect(lettersOf(engine, id).includes('z')).toBeFalsy();
  });

  it('treats repeated letters as no-ops', () => {
    const { engine, clock, dict } = setup();
    const id = turn(engine).currentPlayer;

    const word = playWord(engine, clock, dict);

    // A word with a repeated letter still contributes that letter only once.
    expect(lettersOf(engine, id).length).toBe(new Set(word).size);
    expect(lettersOf(engine, id).length).toBe(new Set(lettersOf(engine, id)).size);
  });

  it('keeps progress per player rather than globally', () => {
    const { engine, clock, dict, a, b } = setup();
    const id = turn(engine).currentPlayer;
    const other = id === a ? b : a;

    playWord(engine, clock, dict);

    expect(lettersOf(engine, other).length).toBe(0);
    expect(lettersOf(engine, id).length > 0).toBeTruthy();
  });
});

describe('Alphabet bonus — reward', () => {
  const oneLetter = { alphabetRequiredLetters: 'a', maxLives: 9 };

  it('grants exactly one life for a completed cycle, then resets the tracker', () => {
    const { engine, clock, dict, events } = setup(oneLetter);
    const id = turn(engine).currentPlayer;
    const before = livesOf(engine, id);

    playWord(engine, clock, dict, 'a');

    const gains = events.filter((e) => e.type === 'LIFE_GAINED' && e.playerId === id);
    expect(gains.length).toBe(1);
    expect(livesOf(engine, id)).toBe(before + 1);
    // Cleared in the same transition that paid out, so it cannot pay twice.
    expect(lettersOf(engine, id).includes('a')).toBeFalsy();
    expect(lettersOf(engine, id).length).toBe(0);
  });

  it('grants a second reward on a second completed cycle', () => {
    const { engine, clock, dict, events } = setup(oneLetter);
    const first = turn(engine).currentPlayer;
    const before = livesOf(engine, first);

    playWord(engine, clock, dict, 'a'); // cycle 1 for `first`
    playWord(engine, clock, dict, 'a'); // the other player's turn
    playWord(engine, clock, dict, 'a'); // cycle 2 for `first`

    const gains = events.filter((e) => e.type === 'LIFE_GAINED' && e.playerId === first);
    expect(gains.length).toBe(2);
    expect(livesOf(engine, first)).toBe(before + 2);
  });

  it('awards the configured number of lives per cycle', () => {
    const { engine, clock, dict } = setup({ ...oneLetter, alphabetBonusLives: 2 });
    const id = turn(engine).currentPlayer;
    const before = livesOf(engine, id);

    playWord(engine, clock, dict, 'a');

    expect(livesOf(engine, id)).toBe(before + 2);
  });

  it('does nothing at all when the bonus is disabled', () => {
    const { engine, clock, dict, events } = setup({
      ...oneLetter,
      alphabetBonusEnabled: false,
    });
    const id = turn(engine).currentPlayer;
    const before = livesOf(engine, id);

    playWord(engine, clock, dict, 'a');

    expect(events.some((e) => e.type === 'LIFE_GAINED')).toBeFalsy();
    expect(livesOf(engine, id)).toBe(before);
    // Letters are still tracked; only the payout is switched off.
    expect(lettersOf(engine, id).includes('a')).toBeTruthy();
  });

  it('never exceeds the maximum life cap', () => {
    const { engine, clock, dict, events } = setup({
      alphabetRequiredLetters: 'a',
      maxLives: 2,
      startingLives: 2,
    });
    const id = turn(engine).currentPlayer;

    playWord(engine, clock, dict, 'a');

    expect(livesOf(engine, id)).toBe(2);
    expect(events.some((e) => e.type === 'LIFE_GAINED' && e.playerId === id)).toBeFalsy();
  });
});

describe('Alphabet bonus — required letter set', () => {
  it('defaults to all 26 letters', () => {
    expect(requiredAlphabet(DEFAULT_RULES).length).toBe(26);
    expect(requiredAlphabet(DEFAULT_RULES).join('')).toBe('abcdefghijklmnopqrstuvwxyz');
  });

  it('normalises case, drops non-letters and collapses duplicates', () => {
    expect(requiredAlphabet({ ...DEFAULT_RULES, alphabetRequiredLetters: 'A-B  b,c!C' }).join('')).toBe(
      'abc',
    );
  });
});
