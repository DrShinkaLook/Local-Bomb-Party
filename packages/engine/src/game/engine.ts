import type {
  BotDifficulty,
  EngineListener,
  GameEvent,
  GameRules,
  GameSnapshot,
  GameState,
  Intent,
  Player,
  PlayerId,
  RoomId,
  TurnId,
  Unsubscribe,
} from '../types.js';
import { DEFAULT_RULES, asPlayerId } from '../types.js';
import type { Dictionary } from '../dictionary/dictionary.js';
import { SyllableGenerator } from '../dictionary/syllables.js';
import { Rng } from '../util/rng.js';
import { Bot } from '../bots/bot.js';
import {
  type Command,
  type EngineContext,
  initialState,
  makePlayer,
  playerById,
  reduce,
} from './machine.js';

/**
 * The authoritative host engine.
 *
 * Wraps the pure reducer with the three things a reducer must not own: a clock,
 * scheduled work (bot moves), and subscribers. Exactly one of these exists per
 * room, on the host machine. Local players, LAN clients and bots are all just
 * sources of `Intent`; none of them can change state except by going through
 * `dispatch`, which is what makes the model authoritative rather than merely
 * synchronised.
 *
 * The engine has no dependency on React, Electron, or the network layer. It is
 * driven by whoever owns the loop — `startLoop()` in production, explicit
 * `tick(t)` calls in tests.
 */

export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/**
 * The engine compiles against `lib: ["ES2022"]` only — no DOM, no @types/node.
 * That is deliberate: it is the compiler-enforced version of "the engine does
 * not depend on its host". Timers are therefore reached through a structurally
 * typed view of the global object rather than by pulling in a platform lib.
 */
interface TimerHost {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const timers = globalThis as unknown as TimerHost;

export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => timers.setInterval(fn, ms),
  clearInterval: (handle) => timers.clearInterval(handle),
};

export interface GameEngineOptions {
  readonly roomId: RoomId;
  readonly dictionary: Dictionary;
  readonly seed: string | number;
  readonly rules?: Partial<GameRules>;
  readonly clock?: Clock;
  /** Tick period. 50ms gives smooth BOMB_TICK audio cues at negligible cost. */
  readonly tickMs?: number;
  readonly syllables?: SyllableGenerator;
}

interface ScheduledBotAction {
  readonly at: number;
  readonly playerId: PlayerId;
  readonly turnId: TurnId;
  readonly word: string | null;
  readonly fumble: string | null;
  /** Set once the fumble has been submitted, so it only fires once. */
  fumbleSent: boolean;
}

export class GameEngine {
  private state: GameState;
  private readonly ctx: EngineContext;
  private readonly clock: Clock;
  private readonly tickMs: number;
  private readonly listeners = new Set<EngineListener>();
  private readonly bots = new Map<PlayerId, Bot>();
  private readonly rng: Rng;
  private pendingBot: ScheduledBotAction | null = null;
  private loopHandle: unknown = null;
  private botCounter = 0;
  private lastTickEmit = 0;

  constructor(options: GameEngineOptions) {
    this.clock = options.clock ?? systemClock;
    this.tickMs = options.tickMs ?? 50;
    this.rng = new Rng(options.seed);

    const rules: GameRules = { ...DEFAULT_RULES, ...options.rules };
    const syllables =
      options.syllables ??
      new SyllableGenerator(options.dictionary, { minWords: rules.minWordsPerSyllable });

    this.ctx = {
      dict: options.dictionary,
      syllables,
      rng: this.rng,
      now: () => this.clock.now(),
    };
    this.state = initialState(options.roomId, rules, this.clock.now());
  }

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  subscribe(listener: EngineListener): Unsubscribe {
    this.listeners.add(listener);
    // Immediately hand the newcomer a full snapshot so a late-joining renderer
    // or LAN client never has to render an empty frame while it waits.
    listener({ type: 'STATE_SYNC', snapshot: this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(events: readonly GameEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) listener(event);
    }
  }

  snapshot(): GameSnapshot {
    return this.state;
  }

  get rules(): GameRules {
    return this.state.rules;
  }

  // -------------------------------------------------------------------------
  // Intent handling
  // -------------------------------------------------------------------------

  /**
   * Apply an intent. This is the only public mutation path, and it is what the
   * network adapter calls on the host when a remote client sends input.
   *
   * `origin` is the authenticated sender. Intents that name a different player
   * are rejected rather than trusted — a client may only act as itself. The
   * host itself passes `null` to act with full authority (adding bots, changing
   * rules).
   */
  dispatch(intent: Intent, origin: PlayerId | null = null): void {
    if (origin !== null && !this.isAuthorised(intent, origin)) {
      this.emit([
        { type: 'ERROR', code: 'FORBIDDEN', message: `${origin} may not issue ${intent.type}` },
      ]);
      return;
    }

    if (intent.type === 'ADD_BOT') {
      this.addBot(intent.difficulty, intent.name);
      return;
    }
    this.apply(intent);
  }

  /** A client may only act as itself, and only host-side intents are privileged. */
  private isAuthorised(intent: Intent, origin: PlayerId): boolean {
    switch (intent.type) {
      case 'TYPING':
      case 'SUBMIT_WORD':
      case 'LEAVE':
      case 'JOIN':
        return intent.playerId === origin;
      case 'ADD_BOT':
      case 'REMOVE_PLAYER':
      case 'RENAME_PLAYER':
      case 'SET_RULES':
      case 'START_GAME':
      case 'RESET_TO_LOBBY':
      case 'PAUSE_GAME':
      case 'RESUME_GAME':
        // Host-only in this build. Room-owner delegation is a roadmap item and
        // belongs here, not in the reducer.
        return false;
      default:
        return false;
    }
  }

  private apply(command: Command): void {
    const before = this.state;
    const { state, events } = reduce(this.state, command, this.ctx);
    this.state = state;

    // Resuming shifts the phase deadlines forward by the paused duration. A
    // bot's queued submission is an absolute timestamp on that same clock, so
    // it has to move by exactly the same amount — otherwise every bot fires
    // the instant play resumes, having "thought" for the length of the pause.
    const resumed = events.find(
      (e): e is Extract<GameEvent, { type: 'GAME_RESUMED' }> => e.type === 'GAME_RESUMED',
    );
    if (resumed !== undefined && this.pendingBot !== null) {
      this.pendingBot = { ...this.pendingBot, at: this.pendingBot.at + resumed.pausedMs };
    }

    this.emit(events);
    this.onTransition(before, state, events);
  }

  // -------------------------------------------------------------------------
  // Player management (host authority)
  // -------------------------------------------------------------------------

  addLocalPlayer(name: string): PlayerId {
    const id = asPlayerId(`local:${name}:${this.state.players.length}`);
    this.apply({ type: 'JOIN', playerId: id, name });
    // Mark the seat as locally controlled so the renderer knows whose input box
    // to focus. Done post-join to keep the reducer free of client concerns.
    this.state = {
      ...this.state,
      players: this.state.players.map((p) =>
        p.id === id ? { ...p, kind: { type: 'human', local: true } } : p,
      ),
    };
    this.emit([{ type: 'STATE_SYNC', snapshot: this.state }]);
    return id;
  }

  addBot(difficulty: BotDifficulty, name?: string): PlayerId {
    this.botCounter += 1;
    const id = asPlayerId(`bot:${difficulty}:${this.botCounter}`);
    const label = name ?? `${BOT_NAMES[(this.botCounter - 1) % BOT_NAMES.length]}`;

    const player: Player = makePlayer(
      id,
      label,
      this.state.players.length,
      this.state.rules.startingLives,
      { type: 'bot', difficulty },
    );
    this.state = {
      ...this.state,
      players: [...this.state.players, player],
      version: this.state.version + 1,
      serverTime: this.clock.now(),
    };
    // Each bot gets its own RNG stream derived from the room seed, so adding or
    // removing one bot does not reshuffle every other bot's decisions.
    this.bots.set(id, new Bot(difficulty, this.ctx.dict, this.rng.fork(id), undefined));
    this.emit([
      { type: 'PLAYER_JOINED', player },
      { type: 'STATE_SYNC', snapshot: this.state },
    ]);
    return id;
  }

  removePlayer(id: PlayerId): void {
    this.bots.delete(id);
    this.apply({ type: 'REMOVE_PLAYER', playerId: id });
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  startLoop(): void {
    if (this.loopHandle !== null) return;
    this.loopHandle = this.clock.setInterval(() => this.tick(), this.tickMs);
  }

  stopLoop(): void {
    if (this.loopHandle === null) return;
    this.clock.clearInterval(this.loopHandle);
    this.loopHandle = null;
  }

  /**
   * Advance the simulation to `now`.
   *
   * Order matters: scheduled bot submissions are flushed *before* the fuse is
   * evaluated, so a bot whose answer is due in the same tick as the explosion
   * gets in first. The alternative silently makes every bot a fraction of a
   * tick worse than its profile claims.
   */
  tick(now: number = this.clock.now()): void {
    // Paused: no bot may answer, no fuse may burn, no tick is emitted. The
    // reducer refuses to advance too, so this is belt-and-braces rather than
    // the only guard.
    if (this.state.pausedAt !== null) return;

    this.flushBotAction(now);
    this.apply({ type: 'TICK', now });
    this.emitBombTick(now);
  }

  private emitBombTick(now: number): void {
    if (this.state.phase.name !== 'turn') return;
    // Throttled to ~10Hz. This event exists for local audio and haptics; remote
    // clients derive the countdown from `bombEndsAt` in the snapshot rather
    // than receiving ten messages a second each.
    if (now - this.lastTickEmit < 100) return;
    this.lastTickEmit = now;
    const remainingMs = Math.max(0, this.state.phase.bombEndsAt - now);
    this.emit([
      { type: 'BOMB_TICK', remainingMs, totalMs: this.state.phase.bombTotalMs },
    ]);
  }

  // -------------------------------------------------------------------------
  // Bot scheduling
  // -------------------------------------------------------------------------

  private onTransition(
    before: GameState,
    after: GameState,
    _events: readonly GameEvent[],
  ): void {
    const turnChanged =
      after.phase.name === 'turn' &&
      (before.phase.name !== 'turn' || before.phase.turnId !== after.phase.turnId);

    if (after.phase.name !== 'turn') {
      this.pendingBot = null;
      return;
    }
    if (!turnChanged) return;

    this.pendingBot = null;
    const bot = this.bots.get(after.phase.currentPlayer);
    if (bot === undefined) return;

    const fuseMs = after.phase.bombTotalMs;
    const decision = bot.decide(after.phase.syllable, after.rules.minWordLength, fuseMs);
    this.pendingBot = {
      at: after.serverTime + decision.delayMs,
      playerId: after.phase.currentPlayer,
      turnId: after.phase.turnId,
      word: decision.word,
      fumble: decision.fumble,
      fumbleSent: false,
    };
  }

  private flushBotAction(now: number): void {
    const pending = this.pendingBot;
    if (pending === null) return;
    if (this.state.phase.name !== 'turn' || this.state.phase.turnId !== pending.turnId) {
      this.pendingBot = null;
      return;
    }

    const start = this.state.phase.bombEndsAt - this.state.phase.bombTotalMs;
    if (!pending.fumbleSent && pending.fumble !== null && now >= start + (pending.at - start) / 2) {
      pending.fumbleSent = true;
      this.apply({ type: 'SUBMIT_WORD', playerId: pending.playerId, word: pending.fumble });
      return;
    }

    if (now < pending.at) return;
    this.pendingBot = null;
    if (pending.word === null) return; // Bot blanked; the fuse decides.
    this.apply({ type: 'SUBMIT_WORD', playerId: pending.playerId, word: pending.word });
  }

  /** Test hook: is a bot move queued, and for when? */
  peekPendingBot(): Readonly<ScheduledBotAction> | null {
    return this.pendingBot;
  }

  hasPlayer(id: PlayerId): boolean {
    return playerById(this.state, id) !== undefined;
  }

  dispose(): void {
    this.stopLoop();
    this.listeners.clear();
    this.bots.clear();
    this.pendingBot = null;
  }
}

const BOT_NAMES = [
  'Fuse',
  'Ember',
  'Wick',
  'Cinder',
  'Flint',
  'Ash',
  'Kindle',
  'Scorch',
] as const;
