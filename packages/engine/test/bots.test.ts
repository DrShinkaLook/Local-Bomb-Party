import { describe, expect, it } from './harness.js';
import { FakeClock, fullDictionary } from './fixtures.js';
import { Bot } from '../src/bots/bot.js';
import { BOT_PROFILES } from '../src/bots/profiles.js';
import { GameEngine } from '../src/game/engine.js';
import { Rng } from '../src/util/rng.js';
import { asRoomId, type BotDifficulty } from '../src/types.js';

const TIERS: readonly BotDifficulty[] = ['easy', 'medium', 'hard', 'impossible'];

/** Common enough that every tier has candidates; the difference is skill, not luck. */
const SYLLABLES = ['ing', 'er', 'at', 'ted', 'ly', 'st', 'ar', 'ion'];

describe('Bot profiles', () => {
  it('defines all four difficulty tiers', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier] === undefined).toBe(false);
    }
  });

  /**
   * The ordering *is* the feature. Without this, a later tweak to one tier can
   * silently make medium stronger than hard and nothing would catch it.
   */
  it('orders every knob monotonically from easy to impossible', () => {
    for (let i = 1; i < TIERS.length; i += 1) {
      const weaker = BOT_PROFILES[TIERS[i - 1] as BotDifficulty];
      const stronger = BOT_PROFILES[TIERS[i] as BotDifficulty];

      expect(stronger.vocabularyFraction > weaker.vocabularyFraction).toBe(true);
      expect(stronger.searchLimit > weaker.searchLimit).toBe(true);
      expect(stronger.missChance < weaker.missChance).toBe(true);
      expect(stronger.fumbleChance < weaker.fumbleChance).toBe(true);
      expect(stronger.shortWordBias < weaker.shortWordBias).toBe(true);
      expect(stronger.minThinkMs < weaker.minThinkMs).toBe(true);
      expect(stronger.maxThinkMs < weaker.maxThinkMs).toBe(true);
    }
  });

  /** Pinned: the brief says leave this tier alone, so drift should fail loudly. */
  it('leaves the impossible tier exactly as it was', () => {
    expect(BOT_PROFILES.impossible).toEqual({
      vocabularyFraction: 1,
      minThinkMs: 0,
      maxThinkMs: 10,
      missChance: 0,
      fumbleChance: 0,
      shortWordBias: 0,
      searchLimit: Number.POSITIVE_INFINITY,
    });
  });

  it('keeps every think-time band internally coherent', () => {
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.minThinkMs).toBeLessThanOrEqual(profile.maxThinkMs);
      expect(profile.missChance).toBeGreaterThanOrEqual(0);
      expect(profile.missChance).toBeLessThanOrEqual(1);
      expect(profile.vocabularyFraction).toBeGreaterThan(0);
      expect(profile.vocabularyFraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('Bot decisions', () => {
  /**
   * The anti-invalid-word guarantee. A bot may deliberately fumble, but the
   * word it actually plays must always be real, contain the syllable, and be
   * long enough — otherwise a bot could lose a life to its own suggestion.
   */
  it('never plays a word that would be rejected', () => {
    const dict = fullDictionary();
    for (const tier of TIERS) {
      const bot = new Bot(tier, dict, new Rng(`valid-${tier}`));
      for (const syllable of SYLLABLES) {
        for (let i = 0; i < 12; i += 1) {
          const { word } = bot.decide(syllable, 3, 8_000);
          if (word === null) continue;
          expect(dict.has(word)).toBe(true);
          expect(word.includes(syllable)).toBe(true);
          expect(word.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('never plays a word already consumed this round', () => {
    const dict = fullDictionary();
    const bot = new Bot('impossible', dict, new Rng('used'));

    const first = bot.decide('ing', 3, 8_000).word as string;
    expect(first === null).toBe(false);
    dict.removeUsedWords(first);

    for (let i = 0; i < 40; i += 1) {
      const { word } = bot.decide('ing', 3, 8_000);
      if (word !== null) expect(word === first).toBe(false);
    }
    dict.resetUsed();
  });

  it('only ever fumbles with a word the dictionary rejects', () => {
    const dict = fullDictionary();
    // The easy tier fumbles most often, so it is the cheapest place to look.
    const bot = new Bot('easy', dict, new Rng('fumble'));
    let seen = 0;
    for (let i = 0; i < 400; i += 1) {
      const { fumble } = bot.decide('ing', 3, 8_000);
      if (fumble === null) continue;
      seen += 1;
      expect(dict.has(fumble)).toBe(false);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('replays an identical decision stream from the same seed', () => {
    const dict = fullDictionary();
    const run = (seed: string): string =>
      SYLLABLES.flatMap((syllable) => {
        const bot = new Bot('medium', dict, new Rng(seed));
        return Array.from({ length: 10 }, () => {
          const d = bot.decide(syllable, 3, 8_000);
          return `${d.word}:${d.delayMs}:${d.fumble}`;
        });
      }).join('|');

    expect(run('seed-a')).toBe(run('seed-a'));
    expect(run('seed-a') === run('seed-b')).toBe(false);
  });

  it('never thinks past the fuse', () => {
    const dict = fullDictionary();
    for (const tier of TIERS) {
      const bot = new Bot(tier, dict, new Rng(`fuse-${tier}`));
      for (const fuseMs of [1_000, 3_000, 5_000, 12_000]) {
        for (let i = 0; i < 20; i += 1) {
          const { delayMs } = bot.decide('ing', 3, fuseMs);
          expect(delayMs).toBeLessThanOrEqual(Math.max(0, fuseMs - 250));
          expect(delayMs).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('Bot skill ordering', () => {
  const sample = (tier: BotDifficulty) => {
    const dict = fullDictionary();
    const bot = new Bot(tier, dict, new Rng(`sample-${tier}`));
    let found = 0;
    let attempts = 0;
    let totalDelay = 0;

    for (const syllable of SYLLABLES) {
      for (let i = 0; i < 30; i += 1) {
        const { word, delayMs } = bot.decide(syllable, 3, 10_000);
        attempts += 1;
        totalDelay += delayMs;
        if (word !== null) found += 1;
      }
    }
    return { rate: found / attempts, meanDelay: totalDelay / attempts };
  };

  it('answers more often as the tier rises', () => {
    const easy = sample('easy');
    const medium = sample('medium');
    const hard = sample('hard');
    const impossible = sample('impossible');

    expect(easy.rate).toBeLessThan(medium.rate);
    expect(medium.rate).toBeLessThan(hard.rate);
    expect(hard.rate).toBeLessThanOrEqual(impossible.rate);
    // The weakest tier must be visibly unreliable, not merely a little worse.
    expect(easy.rate).toBeLessThan(0.75);
    expect(impossible.rate).toBe(1);
  });

  it('answers faster as the tier rises', () => {
    expect(sample('easy').meanDelay).toBeGreaterThan(sample('medium').meanDelay);
    expect(sample('medium').meanDelay).toBeGreaterThan(sample('hard').meanDelay);
    expect(sample('hard').meanDelay).toBeGreaterThan(sample('impossible').meanDelay);
  });

  /** End to end, through the real engine, not just the decision function. */
  it('lets a hard bot beat an easy one across seeded matches', () => {
    let hardWins = 0;
    const games = 8;

    for (let g = 0; g < games; g += 1) {
      const clock = new FakeClock();
      const engine = new GameEngine({
        roomId: asRoomId(`bout-${g}`),
        dictionary: fullDictionary(),
        seed: `bout-${g}`,
        clock,
        tickMs: 50,
        rules: { minBombMs: 4_000, maxBombMs: 7_000, startingLives: 2 },
      });
      const hard = engine.addBot('hard');
      engine.addBot('easy');
      engine.dispatch({ type: 'START_GAME' });

      for (let i = 0; i < 4_000 && engine.snapshot().phase.name !== 'gameOver'; i += 1) {
        clock.advance(50);
        engine.tick(clock.now());
      }
      const phase = engine.snapshot().phase;
      if (phase.name === 'gameOver' && phase.winner === hard) hardWins += 1;
    }
    expect(hardWins).toBeGreaterThanOrEqual(Math.ceil(games * 0.75));
  });
});
