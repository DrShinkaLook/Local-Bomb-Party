import type {
  ChatMessage,
  GameEvent,
  GamePhase,
  GameRules,
  GameState,
  Intent,
  Player,
  PlayerId,
  SyllableDifficulty,
} from '../types.js';
import {
  AVATARS,
  CHAT_HISTORY_LIMIT,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  PLAYER_COLORS,
  asTurnId,
} from '../types.js';
import type { Dictionary } from '../dictionary/dictionary.js';
import type { SyllableGenerator } from '../dictionary/syllables.js';
import type { Rng } from '../util/rng.js';

/**
 * The game as a pure state transition function.
 *
 * `reduce` is the single place a `GameState` may change. It is total (every
 * command is defined for every phase, even if the answer is "ignore"), and it
 * returns a brand-new state plus the events that transition produced — it never
 * mutates its input, schedules a timer, or touches I/O.
 *
 * Purity caveat, stated rather than hidden: `ctx.dict`, `ctx.syllables` and
 * `ctx.rng` are mutable resources threaded through the reducer. Replaying the
 * same command sequence reproduces the same states only when those resources
 * start in the same condition, which is exactly what the host guarantees and
 * what `EngineContext.snapshotResources` exists to check in tests. Keeping them
 * out of `GameState` keeps snapshots small enough to broadcast every turn — a
 * 128k-entry used-word bitset has no business on the wire.
 */

export type Command =
  | Intent
  /** Wall-clock advanced; drives fuse expiry and phase timeouts. */
  | { readonly type: 'TICK'; readonly now: number };

export interface EngineContext {
  readonly dict: Dictionary;
  readonly syllables: SyllableGenerator;
  readonly rng: Rng;
  /** Host clock in epoch milliseconds. Injected so tests can drive time. */
  readonly now: () => number;
}

export interface Transition {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Milliseconds the "starting" countdown and the post-explosion pause last. */
export const COUNTDOWN_MS = 3_000;
/** Longest display name a rename may set. Join is unchanged and uncapped. */

export const EXPLOSION_PAUSE_MS = 1_800;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * The letter set a player must collect for one bonus cycle.
 *
 * Normalised here rather than at the call site so the reducer and the renderer
 * agree on what "complete" means: lowercased, non-letters dropped, duplicates
 * collapsed, sorted.
 */
export const requiredAlphabet = (rules: GameRules): readonly string[] => {
  const seen = new Set<string>();
  for (const ch of rules.alphabetRequiredLetters.toLowerCase()) {
    if (ALPHABET.includes(ch)) seen.add(ch);
  }
  return Array.from(seen).sort();
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const alivePlayers = (state: GameState): readonly Player[] =>
  state.players.filter((p) => p.lives > 0);

export const playerById = (state: GameState, id: PlayerId): Player | undefined =>
  state.players.find((p) => p.id === id);

export const currentPlayerId = (state: GameState): PlayerId | null =>
  state.phase.name === 'turn' ? state.phase.currentPlayer : null;

/**
 * Next seat, in seat order, that still has lives. Returns -1 when nobody does.
 * Wraps at most once around the table, so a fully eliminated room terminates.
 */
export const nextAliveSeat = (state: GameState, fromSeat: number): number => {
  const seats = [...state.players].sort((a, b) => a.seat - b.seat);
  if (seats.length === 0) return -1;
  for (let step = 1; step <= seats.length; step += 1) {
    const candidate = seats[(fromSeat + step) % seats.length] as Player;
    if (candidate.lives > 0) return candidate.seat;
  }
  return -1;
};

// ---------------------------------------------------------------------------
// Small immutable helpers
// ---------------------------------------------------------------------------

const bump = (state: GameState, now: number): GameState => ({
  ...state,
  version: state.version + 1,
  serverTime: now,
});

const withPlayer = (
  state: GameState,
  id: PlayerId,
  update: (player: Player) => Player,
): GameState => ({
  ...state,
  players: state.players.map((p) => (p.id === id ? update(p) : p)),
});

// ---------------------------------------------------------------------------
// Turn construction
// ---------------------------------------------------------------------------

const drawDifficulty = (rules: GameRules, rng: Rng): SyllableDifficulty => {
  const tiers: SyllableDifficulty[] = ['common', 'uncommon', 'rare'];
  const weights = tiers.map((t) => rules.difficultyMix[t] ?? 0);
  return rng.pickWeighted(tiers, weights);
};

/**
 * Begin a turn for `seat`, drawing a fresh syllable and fuse length.
 *
 * The fuse is randomised per turn within the configured band. Because the
 * length is decided by the seeded RNG and stored as an absolute `bombEndsAt`,
 * every client renders the same countdown without needing its own timer to
 * agree with the host's — clock skew shifts the whole bar, not the outcome.
 */
const startTurn = (
  state: GameState,
  ctx: EngineContext,
  seat: number,
  now: number,
): Transition => {
  const player = state.players.find((p) => p.seat === seat);
  if (player === undefined) return endGame(state, ctx, now);

  const difficulty = drawDifficulty(state.rules, ctx.rng);
  const syllable = ctx.syllables.getRandomSyllable(
    difficulty,
    ctx.rng,
    state.rules.minWordsPerSyllable,
  );
  const bombTotalMs = ctx.rng.range(state.rules.minBombMs, state.rules.maxBombMs);
  const turnId = asTurnId(nextTurnId(state));

  const next: GameState = bump(
    {
      ...state,
      activeSeat: seat,
      typing: '',
      phase: {
        name: 'turn',
        turnId,
        currentPlayer: player.id,
        syllable,
        syllableDifficulty: difficulty,
        bombEndsAt: now + bombTotalMs,
        bombTotalMs,
      },
    },
    now,
  );

  return {
    state: next,
    events: [
      { type: 'TURN_STARTED', turnId, playerId: player.id, syllable, bombTotalMs },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

const nextTurnId = (state: GameState): number =>
  state.phase.name === 'turn' ? (state.phase.turnId as number) + 1 : 1;

const endGame = (state: GameState, _ctx: EngineContext, now: number): Transition => {
  const alive = alivePlayers(state);
  const winner = alive.length === 1 ? (alive[0] as Player).id : null;
  const next = bump({ ...state, typing: '', phase: { name: 'gameOver', winner } }, now);
  return {
    state: next,
    events: [
      { type: 'GAME_OVER', winner },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

/** After an explosion or a correct answer, hand the bomb on. */
const advance = (state: GameState, ctx: EngineContext, now: number): Transition => {
  if (alivePlayers(state).length <= 1) return endGame(state, ctx, now);
  const seat = nextAliveSeat(state, state.activeSeat);
  if (seat < 0) return endGame(state, ctx, now);
  return startTurn(state, ctx, seat, now);
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const reduce = (state: GameState, command: Command, ctx: EngineContext): Transition => {
  const now = command.type === 'TICK' ? command.now : ctx.now();

  switch (command.type) {
    case 'TICK':
      return tick(state, ctx, now);

    case 'JOIN':
      return join(state, command.playerId, command.name, now);

    case 'LEAVE':
      return leave(state, ctx, command.playerId, now);

    case 'ADD_BOT':
      // The host resolves bot identity before dispatch; see GameEngine.addBot.
      return { state, events: [] };

    case 'REMOVE_PLAYER':
      return leave(state, ctx, command.playerId, now);

    case 'SET_RULES':
      if (state.phase.name !== 'lobby') return refuse(state, 'RULES_LOCKED');
      return {
        state: bump({ ...state, rules: { ...state.rules, ...command.rules } }, now),
        events: [{ type: 'STATE_SYNC', snapshot: bump({ ...state, rules: { ...state.rules, ...command.rules } }, now) }],
      };

    case 'START_GAME':
      return start(state, now);

    case 'RESET_TO_LOBBY':
      return resetToLobby(state, ctx, now);

    case 'TYPING':
      return typing(state, command.playerId, command.text, now);

    case 'SUBMIT_WORD':
      return submit(state, ctx, command.playerId, command.word, now);

    case 'RENAME_PLAYER':
      return rename(state, command.playerId, command.name, now);

    case 'SEND_CHAT':
      return sendChat(state, command.playerId, command.text, now);

    case 'SET_READY':
      return setReady(state, command.playerId, command.ready, now);

    case 'SET_APPEARANCE':
      return setAppearance(state, command.playerId, command.avatar, command.color, now);

    case 'PAUSE_GAME':
      return pause(state, now);

    case 'RESUME_GAME':
      return resume(state, now);

    default: {
      const exhaustive: never = command;
      return { state, events: [{ type: 'ERROR', code: 'UNKNOWN_COMMAND', message: String(exhaustive) }] };
    }
  }
};

const refuse = (state: GameState, code: string): Transition => ({
  state,
  events: [{ type: 'ERROR', code, message: `command rejected in phase ${state.phase.name}` }],
});

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

const emptyStats = () => ({
  wordsPlayed: 0,
  lettersUsed: 0,
  longestWord: '',
  turnsSurvived: 0,
  turnsExploded: 0,
  alphabetUsed: [] as readonly string[],
});

export const makePlayer = (
  id: PlayerId,
  name: string,
  seat: number,
  lives: number,
  kind: Player['kind'],
): Player => ({
  id,
  name,
  kind,
  lives,
  seat,
  connected: true,
  // Bots are always willing; only humans have to say so.
  ready: kind.type === 'bot',
  // Seat-derived defaults mean a sixteen-player lobby is legible before anyone
  // touches the pickers.
  avatar: AVATARS[seat % AVATARS.length] as string,
  color: PLAYER_COLORS[seat % PLAYER_COLORS.length] as string,
  stats: emptyStats(),
});

const join = (state: GameState, id: PlayerId, name: string, now: number): Transition => {
  if (playerById(state, id) !== undefined) {
    // Reconnect rather than duplicate: the seat and lives are preserved, which
    // is what makes a dropped LAN client able to rejoin mid-round.
    const next = bump(withPlayer(state, id, (p) => ({ ...p, connected: true })), now);
    return { state: next, events: [{ type: 'STATE_SYNC', snapshot: next }] };
  }
  if (state.phase.name !== 'lobby') return refuse(state, 'GAME_IN_PROGRESS');
  if (state.players.length >= state.rules.playerLimit) return refuse(state, 'ROOM_FULL');

  const seat = state.players.length;
  const player = makePlayer(id, name, seat, state.rules.startingLives, {
    type: 'human',
    local: false,
  });
  const next = bump({ ...state, players: [...state.players, player] }, now);
  return {
    state: next,
    events: [
      { type: 'PLAYER_JOINED', player },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

const leave = (
  state: GameState,
  ctx: EngineContext,
  id: PlayerId,
  now: number,
): Transition => {
  const player = playerById(state, id);
  if (player === undefined) return { state, events: [] };

  const wasTheirTurn = state.phase.name === 'turn' && state.phase.currentPlayer === id;
  const withoutPlayer: GameState = bump(
    { ...state, players: state.players.filter((p) => p.id !== id) },
    now,
  );

  const events: GameEvent[] = [{ type: 'PLAYER_LEFT', playerId: id }];

  if (withoutPlayer.phase.name === 'lobby') {
    // Reseat so seat indices stay dense; seat order is the turn order.
    const reseated: GameState = {
      ...withoutPlayer,
      players: withoutPlayer.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p, i) => ({ ...p, seat: i })),
    };
    return { state: reseated, events: [...events, { type: 'STATE_SYNC', snapshot: reseated }] };
  }

  if (alivePlayers(withoutPlayer).length <= 1) {
    const done = endGame(withoutPlayer, ctx, now);
    return { state: done.state, events: [...events, ...done.events] };
  }
  if (wasTheirTurn) {
    const moved = advance(withoutPlayer, ctx, now);
    return { state: moved.state, events: [...events, ...moved.events] };
  }
  return { state: withoutPlayer, events: [...events, { type: 'STATE_SYNC', snapshot: withoutPlayer }] };
};

const start = (state: GameState, now: number): Transition => {
  if (state.phase.name !== 'lobby' && state.phase.name !== 'gameOver') {
    return refuse(state, 'ALREADY_STARTED');
  }
  if (state.players.length < 1) return refuse(state, 'NOT_ENOUGH_PLAYERS');

  const next = bump(
    {
      ...state,
      usedWords: [],
      typing: '',
      activeSeat: -1,
      players: state.players.map((p) => ({
        ...p,
        lives: state.rules.startingLives,
        stats: emptyStats(),
      })),
      phase: { name: 'starting', endsAt: now + COUNTDOWN_MS },
    },
    now,
  );
  return {
    state: next,
    events: [
      { type: 'GAME_STARTED' },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

const resetToLobby = (state: GameState, ctx: EngineContext, now: number): Transition => {
  ctx.dict.resetUsed();
  ctx.syllables.resetHistory();
  const next = bump(
    {
      ...state,
      usedWords: [],
      typing: '',
      activeSeat: -1,
      pausedAt: null,
      players: state.players.map((p) => ({ ...p, lives: state.rules.startingLives })),
      phase: { name: 'lobby' },
    },
    now,
  );
  return { state: next, events: [{ type: 'STATE_SYNC', snapshot: next }] };
};

/** Phases that own a deadline, and are therefore the only pausable ones. */
const isTimedPhase = (phase: GamePhase): boolean =>
  phase.name === 'starting' || phase.name === 'turn' || phase.name === 'exploded';

const pause = (state: GameState, now: number): Transition => {
  if (!isTimedPhase(state.phase)) return refuse(state, 'NOT_PAUSABLE');
  if (state.pausedAt !== null) return refuse(state, 'ALREADY_PAUSED');
  const next = bump({ ...state, pausedAt: now }, now);
  return {
    state: next,
    events: [
      { type: 'GAME_PAUSED', pausedAt: now },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

/**
 * Resume by pushing every deadline in the current phase forward by exactly how
 * long the game sat paused.
 *
 * This is the only definition of "pause" that neither robs the active player of
 * fuse nor hands them extra: they resume with the same milliseconds remaining
 * they stopped with. It also keeps `bombEndsAt` a genuine absolute deadline, so
 * no clock elsewhere needs to learn what "paused" means.
 */
const resume = (state: GameState, now: number): Transition => {
  if (state.pausedAt === null) return refuse(state, 'NOT_PAUSED');
  const pausedMs = Math.max(0, now - state.pausedAt);
  const next = bump(
    { ...state, pausedAt: null, phase: shiftDeadlines(state.phase, pausedMs) },
    now,
  );
  return {
    state: next,
    events: [
      { type: 'GAME_RESUMED', pausedMs },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

const shiftDeadlines = (phase: GamePhase, by: number): GamePhase => {
  switch (phase.name) {
    case 'starting':
      return { ...phase, endsAt: phase.endsAt + by };
    case 'turn':
      return { ...phase, bombEndsAt: phase.bombEndsAt + by };
    case 'exploded':
      return { ...phase, endsAt: phase.endsAt + by };
    default:
      return phase;
  }
};

/**
 * Renaming is lobby-only, which is what keeps it free of mid-round trickery:
 * a name cannot change while it is on a scoreboard or a turn indicator.
 */
const rename = (state: GameState, id: PlayerId, name: string, now: number): Transition => {
  if (state.phase.name !== 'lobby') return refuse(state, 'RENAME_LOCKED');
  const player = playerById(state, id);
  if (player === undefined) return refuse(state, 'NO_SUCH_PLAYER');

  const clean = name.trim().slice(0, MAX_NAME_LENGTH);
  if (clean.length === 0) return refuse(state, 'EMPTY_NAME');
  if (clean === player.name) return { state, events: [] };

  const next = bump(withPlayer(state, id, (p) => ({ ...p, name: clean })), now);
  return {
    state: next,
    events: [
      { type: 'PLAYER_RENAMED', playerId: id, name: clean },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

const typing = (state: GameState, id: PlayerId, text: string, now: number): Transition => {
  if (state.phase.name !== 'turn' || state.phase.currentPlayer !== id) {
    return { state, events: [] };
  }
  if (state.pausedAt !== null) return { state, events: [] };
  // Typing is high-frequency and low-stakes: mutate the field, bump the
  // version, but do not emit a discrete event. Clients render from the
  // snapshot, so one message type carries it.
  const next = bump({ ...state, typing: text.slice(0, 64) }, now);
  return { state: next, events: [{ type: 'STATE_SYNC', snapshot: next }] };
};

const submit = (
  state: GameState,
  ctx: EngineContext,
  id: PlayerId,
  word: string,
  now: number,
): Transition => {
  if (state.phase.name !== 'turn') return refuse(state, 'NOT_IN_TURN');
  if (state.pausedAt !== null) return refuse(state, 'GAME_PAUSED');
  if (state.phase.currentPlayer !== id) return refuse(state, 'NOT_YOUR_TURN');

  const result = ctx.dict.validateWord(word, state.phase.syllable, state.rules.minWordLength);
  const events: GameEvent[] = [{ type: 'WORD_SUBMITTED', playerId: id, word, result }];

  if (!result.ok) {
    // A wrong answer costs time, not a life: the bomb keeps burning. Only the
    // fuse eliminates.
    const next = bump({ ...state, typing: '' }, now);
    return { state: next, events: [...events, { type: 'STATE_SYNC', snapshot: next }] };
  }

  const accepted = result.word;
  if (state.rules.forbidWordReuse) ctx.dict.removeUsedWords(accepted);

  const player = playerById(state, id) as Player;
  const required = requiredAlphabet(state.rules);
  const letters = new Set(player.stats.alphabetUsed);
  // The validator already guarantees the word is alphabetic; this keeps the
  // tracker letters-only regardless, so a rules change cannot poison it.
  for (const ch of accepted) if (ALPHABET.includes(ch)) letters.add(ch);

  const completedAlphabet =
    state.rules.alphabetBonusEnabled &&
    required.length > 0 &&
    required.every((ch) => letters.has(ch));

  // Awarded exactly once per cycle: the tracker is cleared in the very same
  // transition that grants the reward, so no timer, re-render, snapshot or
  // repeated event can pay it twice. Still capped by maxLives.
  const reward = completedAlphabet
    ? Math.max(0, Math.min(state.rules.alphabetBonusLives, state.rules.maxLives - player.lives))
    : 0;

  let updated: GameState = withPlayer(state, id, (p) => ({
    ...p,
    lives: p.lives + reward,
    stats: {
      wordsPlayed: p.stats.wordsPlayed + 1,
      lettersUsed: p.stats.lettersUsed + accepted.length,
      longestWord: accepted.length > p.stats.longestWord.length ? accepted : p.stats.longestWord,
      turnsSurvived: p.stats.turnsSurvived + 1,
      turnsExploded: p.stats.turnsExploded,
      alphabetUsed: completedAlphabet ? [] : Array.from(letters).sort(),
    },
  }));
  updated = { ...updated, usedWords: [...updated.usedWords, accepted] };

  if (reward > 0) events.push({ type: 'LIFE_GAINED', playerId: id, reason: 'alphabet' });

  const moved = advance(updated, ctx, now);
  return { state: moved.state, events: [...events, ...moved.events] };
};

const tick = (state: GameState, ctx: EngineContext, now: number): Transition => {
  // A paused game crosses no deadline. Every branch below compares against
  // `now`, so freezing here freezes the countdown, the fuse and the
  // post-explosion pause together.
  if (state.pausedAt !== null) return { state, events: [] };

  switch (state.phase.name) {
    case 'starting': {
      if (now < state.phase.endsAt) return { state, events: [] };
      const seat = nextAliveSeat({ ...state, activeSeat: -1 }, -1);
      if (seat < 0) return endGame(state, ctx, now);
      return startTurn(state, ctx, seat, now);
    }

    case 'turn': {
      if (now < state.phase.bombEndsAt) return { state, events: [] };
      return explode(state, ctx, now);
    }

    case 'exploded': {
      if (now < state.phase.endsAt) return { state, events: [] };
      return advance(state, ctx, now);
    }

    default:
      return { state, events: [] };
  }
};

const explode = (state: GameState, ctx: EngineContext, now: number): Transition => {
  if (state.phase.name !== 'turn') return { state, events: [] };
  const victimId = state.phase.currentPlayer;
  const syllable = state.phase.syllable;

  const damaged = withPlayer(state, victimId, (p) => ({
    ...p,
    lives: Math.max(0, p.lives - 1),
    stats: { ...p.stats, turnsExploded: p.stats.turnsExploded + 1 },
  }));

  const victim = playerById(damaged, victimId) as Player;
  const events: GameEvent[] = [
    { type: 'PLAYER_EXPLODED', playerId: victimId, livesLeft: victim.lives },
  ];
  if (victim.lives === 0) events.push({ type: 'PLAYER_ELIMINATED', playerId: victimId });

  if (alivePlayers(damaged).length <= 1) {
    const done = endGame(damaged, ctx, now);
    return { state: done.state, events: [...events, ...done.events] };
  }

  const next = bump(
    {
      ...damaged,
      typing: '',
      phase: {
        name: 'exploded',
        victim: victimId,
        syllable,
        endsAt: now + EXPLOSION_PAUSE_MS,
      },
    },
    now,
  );
  return { state: next, events: [...events, { type: 'STATE_SYNC', snapshot: next }] };
};

// ---------------------------------------------------------------------------
// Lobby: readiness and appearance
// ---------------------------------------------------------------------------

/**
 * Whether everyone who needs to agree has agreed.
 *
 * Exported because the renderer needs the same answer to decide whether to
 * offer the Start button, and a rule with two implementations is a rule with
 * two behaviours. Disconnected players are excluded: a room should not be held
 * hostage by a laptop that went to sleep.
 */
export const allPlayersReady = (state: GameState): boolean =>
  state.players
    .filter((p) => p.kind.type === 'human' && p.connected)
    .every((p) => p.ready);

const setReady = (
  state: GameState,
  id: PlayerId,
  ready: boolean,
  now: number,
): Transition => {
  if (state.phase.name !== 'lobby') return refuse(state, 'NOT_IN_LOBBY');
  const player = playerById(state, id);
  if (player === undefined) return refuse(state, 'NO_SUCH_PLAYER');
  if (player.ready === ready) return { state, events: [] };

  const next = bump(withPlayer(state, id, (p) => ({ ...p, ready })), now);
  return { state: next, events: [{ type: 'STATE_SYNC', snapshot: next }] };
};

/**
 * Change avatar or colour.
 *
 * Values are matched against the shipped lists rather than stored as given.
 * That is the whole reason appearance is an index into a palette: a LAN peer
 * cannot push a URL, an emoji wall, or a chunk of CSS onto everyone else's
 * screen through this path. An unrecognised value leaves the field untouched
 * rather than failing the whole intent.
 */
const setAppearance = (
  state: GameState,
  id: PlayerId,
  avatar: string | undefined,
  color: string | undefined,
  now: number,
): Transition => {
  if (state.phase.name !== 'lobby') return refuse(state, 'NOT_IN_LOBBY');
  const player = playerById(state, id);
  if (player === undefined) return refuse(state, 'NO_SUCH_PLAYER');

  const nextAvatar = avatar !== undefined && AVATARS.includes(avatar) ? avatar : player.avatar;
  const nextColor =
    color !== undefined && PLAYER_COLORS.includes(color) ? color : player.color;

  if (nextAvatar === player.avatar && nextColor === player.color) {
    return { state, events: [] };
  }

  const next = bump(
    withPlayer(state, id, (p) => ({ ...p, avatar: nextAvatar, color: nextColor })),
    now,
  );
  return { state: next, events: [{ type: 'STATE_SYNC', snapshot: next }] };
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/**
 * Accept a chat message.
 *
 * Chat lives in `GameState` rather than in a channel of its own, which buys a
 * lot for very little: it reaches LAN clients over the snapshot path that
 * already exists, a reconnecting client gets the backlog from its WELCOME
 * snapshot for free, and there is no second ordering to keep consistent with
 * game events. The cost is that the history travels with every state change,
 * which is why it is capped rather than unbounded.
 *
 * Whose turn it is deliberately does not matter here. Dedicating the keyboard
 * to the bomb word on your own turn is a presentation decision — the renderer
 * disables the chat box — not a rule, and the engine has no business enforcing
 * one that changes nothing about the game.
 */
const sendChat = (
  state: GameState,
  id: PlayerId,
  text: string,
  now: number,
): Transition => {
  if (!state.rules.chatEnabled) return refuse(state, 'CHAT_DISABLED');

  const author = playerById(state, id);
  if (author === undefined) return refuse(state, 'UNKNOWN_PLAYER');

  // Collapse runs of whitespace as well as trimming: a message of forty
  // newlines is not a message, and it would wreck the transcript layout.
  const body = text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
  if (body.length === 0) return refuse(state, 'EMPTY_MESSAGE');

  const previous = state.chat[state.chat.length - 1];
  const message: ChatMessage = {
    id: (previous?.id ?? 0) + 1,
    playerId: id,
    name: author.name,
    text: body,
    at: now,
  };

  const chat = [...state.chat, message].slice(-CHAT_HISTORY_LIMIT);
  const next = bump({ ...state, chat }, now);
  return {
    state: next,
    events: [
      { type: 'CHAT_MESSAGE', message },
      { type: 'STATE_SYNC', snapshot: next },
    ],
  };
};

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState = (
  roomId: GameState['roomId'],
  rules: GameRules,
  now: number,
  roomCode: string,
): GameState => ({
  roomId,
  roomCode,
  rules,
  phase: { name: 'lobby' },
  pausedAt: null,
  players: [],
  activeSeat: -1,
  usedWords: [],
  typing: '',
  chat: [],
  version: 0,
  serverTime: now,
});
