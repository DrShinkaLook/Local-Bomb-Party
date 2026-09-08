/**
 * Core domain types for the Bomb Party engine.
 *
 * Everything in this file is transport-agnostic and render-agnostic: no React,
 * no Electron, no Node built-ins. The renderer and the network layer both
 * depend on these types; neither is depended upon by them.
 */

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type PlayerId = Brand<string, 'PlayerId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type TurnId = Brand<number, 'TurnId'>;

export const asPlayerId = (v: string): PlayerId => v as PlayerId;
export const asRoomId = (v: string): RoomId => v as RoomId;
export const asTurnId = (v: number): TurnId => v as TurnId;

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type BotDifficulty = 'easy' | 'medium' | 'impossible';

export type PlayerKind =
  | { readonly type: 'human'; readonly local: boolean }
  | { readonly type: 'bot'; readonly difficulty: BotDifficulty };

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly kind: PlayerKind;
  /** Remaining lives. Zero means eliminated for the current round. */
  readonly lives: number;
  /** Seat order within the room; stable for the lifetime of the room. */
  readonly seat: number;
  readonly connected: boolean;
  readonly stats: PlayerStats;
}

export interface PlayerStats {
  readonly wordsPlayed: number;
  readonly lettersUsed: number;
  readonly longestWord: string;
  readonly turnsSurvived: number;
  readonly turnsExploded: number;
  /** Bitmask-free alphabet tracker: letters of the alphabet used at least once. */
  readonly alphabetUsed: readonly string[];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type SyllableDifficulty = 'common' | 'uncommon' | 'rare';

export interface GameRules {
  /** Lives each player starts a round with. */
  readonly startingLives: number;
  /** Hard ceiling on lives gained from bonuses. */
  readonly maxLives: number;
  /** Inclusive bounds, in milliseconds, for the randomised bomb fuse. */
  readonly minBombMs: number;
  readonly maxBombMs: number;
  /**
   * Consecutive successful turns on the same syllable before it is rerolled.
   * JKLM-style play rerolls on explosion; this generalises that.
   */
  readonly syllableRerollAfterMisses: number;
  /** A word may not be reused within a round. */
  readonly forbidWordReuse: boolean;
  /** Minimum accepted word length. */
  readonly minWordLength: number;
  /** Collecting the required letter set grants lives. */
  readonly alphabetBonusEnabled: boolean;
  /**
   * The letters a player must collect to complete one cycle. Non-alphabetic
   * characters are ignored and duplicates collapse, so "A-Z" style subsets are
   * expressible without a separate validation pass.
   */
  readonly alphabetRequiredLetters: string;
  /** Lives awarded per completed cycle, still capped by `maxLives`. */
  readonly alphabetBonusLives: number;
  /** Weighted mix used when drawing a new syllable. */
  readonly difficultyMix: Readonly<Record<SyllableDifficulty, number>>;
  /**
   * A syllable is only offered if at least this many *unused* words contain it.
   * This is the safety valve that prevents impossible prompts.
   */
  readonly minWordsPerSyllable: number;
}

export const DEFAULT_RULES: GameRules = {
  startingLives: 2,
  maxLives: 3,
  minBombMs: 5_000,
  maxBombMs: 12_000,
  syllableRerollAfterMisses: 1,
  forbidWordReuse: true,
  minWordLength: 3,
  alphabetBonusEnabled: true,
  alphabetRequiredLetters: 'abcdefghijklmnopqrstuvwxyz',
  alphabetBonusLives: 1,
  difficultyMix: { common: 0.6, uncommon: 0.3, rare: 0.1 },
  minWordsPerSyllable: 60,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationFailure =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'NON_ALPHABETIC'
  | 'MISSING_SYLLABLE'
  | 'NOT_A_WORD'
  | 'ALREADY_USED';

export type ValidationResult =
  /** `word` is the normalised (trimmed, lowercased) form that was accepted. */
  | { readonly ok: true; readonly word: string }
  | { readonly ok: false; readonly reason: ValidationFailure };

// ---------------------------------------------------------------------------
// Game phases
// ---------------------------------------------------------------------------

export type GamePhase =
  /** Room open, players joining, nobody playing yet. */
  | { readonly name: 'lobby' }
  /** Short countdown between "start" being pressed and the first turn. */
  | { readonly name: 'starting'; readonly endsAt: number }
  /** A player is on the clock. */
  | {
      readonly name: 'turn';
      readonly turnId: TurnId;
      readonly currentPlayer: PlayerId;
      readonly syllable: string;
      readonly syllableDifficulty: SyllableDifficulty;
      /** Wall-clock ms (host clock) at which the bomb detonates. */
      readonly bombEndsAt: number;
      /** Total fuse length, so the renderer can compute a 0..1 progress value. */
      readonly bombTotalMs: number;
    }
  /** Bomb went off; brief pause before the next turn. */
  | {
      readonly name: 'exploded';
      readonly victim: PlayerId;
      readonly syllable: string;
      readonly endsAt: number;
    }
  /** One player left standing. */
  | { readonly name: 'gameOver'; readonly winner: PlayerId | null };

// ---------------------------------------------------------------------------
// Authoritative state and snapshots
// ---------------------------------------------------------------------------

/**
 * The complete authoritative state. Only the host holds one of these.
 * Clients receive `GameSnapshot`, which is the same shape minus anything a
 * client has no business knowing (currently: nothing, but the split exists so
 * hidden information can be added without touching call sites).
 */
export interface GameState {
  readonly roomId: RoomId;
  readonly rules: GameRules;
  readonly phase: GamePhase;
  /**
   * Host clock at which the game was paused, or null when running.
   *
   * Pausing freezes the simulation rather than rewriting it: every deadline in
   * `phase` is left untouched and simply shifted forward by the paused duration
   * on resume. That keeps `bombEndsAt` an absolute deadline in every phase, so
   * the renderer needs no separate notion of "paused time".
   */
  readonly pausedAt: number | null;
  readonly players: readonly Player[];
  /** Seat index whose turn it is; advances past eliminated players. */
  readonly activeSeat: number;
  /** Words already played this round, lowercased. */
  readonly usedWords: readonly string[];
  /** What the current player has typed so far, mirrored to spectators. */
  readonly typing: string;
  /** Monotonic version; clients drop out-of-order snapshots. */
  readonly version: number;
  /** Host clock at snapshot time, for latency estimation on clients. */
  readonly serverTime: number;
}

export type GameSnapshot = GameState;

// ---------------------------------------------------------------------------
// Intents (client -> host) and events (host -> everyone)
// ---------------------------------------------------------------------------

export type Intent =
  | { readonly type: 'JOIN'; readonly playerId: PlayerId; readonly name: string }
  | { readonly type: 'LEAVE'; readonly playerId: PlayerId }
  | { readonly type: 'ADD_BOT'; readonly difficulty: BotDifficulty; readonly name?: string }
  | { readonly type: 'REMOVE_PLAYER'; readonly playerId: PlayerId }
  | { readonly type: 'SET_RULES'; readonly rules: Partial<GameRules> }
  | { readonly type: 'START_GAME' }
  | { readonly type: 'RESET_TO_LOBBY' }
  | { readonly type: 'TYPING'; readonly playerId: PlayerId; readonly text: string }
  | { readonly type: 'SUBMIT_WORD'; readonly playerId: PlayerId; readonly word: string }
  | { readonly type: 'RENAME_PLAYER'; readonly playerId: PlayerId; readonly name: string }
  | { readonly type: 'PAUSE_GAME' }
  | { readonly type: 'RESUME_GAME' };

export type GameEvent =
  | { readonly type: 'STATE_SYNC'; readonly snapshot: GameSnapshot }
  | { readonly type: 'PLAYER_JOINED'; readonly player: Player }
  | { readonly type: 'PLAYER_LEFT'; readonly playerId: PlayerId }
  | { readonly type: 'GAME_STARTED' }
  | { readonly type: 'GAME_PAUSED'; readonly pausedAt: number }
  | { readonly type: 'GAME_RESUMED'; readonly pausedMs: number }
  | { readonly type: 'PLAYER_RENAMED'; readonly playerId: PlayerId; readonly name: string }
  | {
      readonly type: 'TURN_STARTED';
      readonly turnId: TurnId;
      readonly playerId: PlayerId;
      readonly syllable: string;
      readonly bombTotalMs: number;
    }
  | { readonly type: 'BOMB_TICK'; readonly remainingMs: number; readonly totalMs: number }
  | {
      readonly type: 'WORD_SUBMITTED';
      readonly playerId: PlayerId;
      readonly word: string;
      readonly result: ValidationResult;
    }
  | { readonly type: 'LIFE_GAINED'; readonly playerId: PlayerId; readonly reason: 'alphabet' }
  | { readonly type: 'PLAYER_EXPLODED'; readonly playerId: PlayerId; readonly livesLeft: number }
  | { readonly type: 'PLAYER_ELIMINATED'; readonly playerId: PlayerId }
  | { readonly type: 'GAME_OVER'; readonly winner: PlayerId | null }
  | { readonly type: 'ERROR'; readonly code: string; readonly message: string };

export type EngineListener = (event: GameEvent) => void;
export type Unsubscribe = () => void;
