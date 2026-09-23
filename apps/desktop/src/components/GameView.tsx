import { useEffect, useState } from 'react';
import { bombIntensity, requiredAlphabet } from '@bombparty/engine';
import type { GameSnapshot, Intent, PlayerId } from '@bombparty/engine';
import { Bomb } from './Bomb.js';
import { Chat } from './Chat.js';
import { PlayerRing } from './PlayerRing.js';
import { WordInput } from './WordInput.js';
import { useFuse } from '../hooks/useFuse.js';
import { useElementSize } from '../hooks/useElementSize.js';
import { stageLayout, type AlphabetPlacement } from '../layout/stage.js';
import type { Toast } from '../hooks/useSession.js';

interface GameViewProps {
  readonly snapshot: GameSnapshot;
  readonly selfId: PlayerId | null;
  readonly toasts: readonly Toast[];
  readonly rejection: string | null;
  readonly exploding: boolean;
  readonly screenShake: boolean;
  readonly reducedMotion: boolean;
  readonly isHost: boolean;
  readonly onSend: (intent: Intent) => void;
  readonly onHostIntent: (intent: Intent) => void;
  readonly onLeave: () => void;
}

export const GameView = ({
  snapshot,
  selfId,
  toasts,
  rejection,
  exploding,
  screenShake,
  reducedMotion,
  isHost,
  onSend,
  onHostIntent,
  onLeave,
}: GameViewProps) => {
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Everything about the stage's shape is derived from its measured box, not
  // from constants, so the same code lays out a wide desktop window and a
  // portrait phone.
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  const layout = stageLayout(stageSize.width, stageSize.height);
  const { progress, remainingMs } = useFuse(snapshot);
  const phase = snapshot.phase;
  const paused = snapshot.pausedAt !== null;
  const myTurn = phase.name === 'turn' && phase.currentPlayer === selfId && !paused;

  // Only the host may stop the clock, and only in a phase that has one — the
  // engine refuses anything else, so this just keeps the button honest.
  const pausable =
    isHost && (phase.name === 'starting' || phase.name === 'turn' || phase.name === 'exploded');

  const togglePause = (): void => {
    if (!pausable) return;
    onHostIntent({ type: paused ? 'RESUME_GAME' : 'PAUSE_GAME' });
  };

  // Escape is the pause key people already expect from a game. It is bound on
  // the window rather than the input so it works while typing an answer.
  useEffect(() => {
    if (!pausable) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onHostIntent({ type: paused ? 'RESUME_GAME' : 'PAUSE_GAME' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pausable, paused, onHostIntent]);

  // Urgency comes from the engine so the UI cannot disagree with the
  // authoritative clock: `visualProgress` still lands on 1.0 exactly when the
  // bomb detonates, it just gets there on an accelerating curve.
  const { intensity, visualProgress } = bombIntensity(progress, snapshot.rules);

  // Shake has two parts. The cubic of raw progress is the v0.2 behaviour and
  // is left exactly as it was, so nothing before the acceleration threshold
  // changes. The intensity term is new and contributes only past it.
  const motion = screenShake && !reducedMotion && !paused;
  const shakePx = motion ? Math.pow(progress, 3) * 7 + intensity * 8 : 0;
  const shaking = shakePx > 0.4 && phase.name === 'turn';

  // Rate rises with intensity as well as amplitude — a bigger wobble at the
  // same speed reads as "louder", not "faster". Quantised to 10ms so a value
  // that changes every frame does not invalidate styles every frame.
  const shakeMs = Math.round((220 - intensity * 130) / 10) * 10;

  return (
    <div
      ref={stageRef}
      className={['stage relative h-full w-full overflow-hidden', shaking ? 'shakeable' : ''].join(' ')}
      style={{
        ['--shake' as string]: `${shakePx}px`,
        ['--shake-ms' as string]: `${shakeMs}ms`,
      }}
    >
      <header className="safe-top pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-6 py-4">
        <span className="font-display text-sm tracking-widest" style={{ color: 'var(--bp-muted)' }}>
          ROUND · {snapshot.usedWords.length} words played
        </span>
        <span className="pointer-events-auto flex items-center gap-4">
          <span className="text-xs" style={{ color: 'var(--bp-muted)' }}>
            {phase.name === 'turn' ? `${phase.syllableDifficulty} syllable` : phase.name}
          </span>
          {pausable ? (
            <button
              className="panel rounded-lg px-3 py-1.5 text-xs uppercase tracking-wide transition-colors hover:bg-white/5"
              onClick={togglePause}
            >
              {paused ? 'Resume' : 'Pause'}
            </button>
          ) : null}
          <button
            className="panel rounded-lg px-3 py-1.5 text-xs uppercase tracking-wide transition-colors hover:bg-white/5"
            onClick={() => setConfirmLeave(true)}
          >
            Leave
          </button>
        </span>
      </header>

      <AlphabetTrack snapshot={snapshot} selfId={selfId} placement={layout.alphabet} />

      <div className="relative flex h-full w-full items-center justify-center">
        <PlayerRing
          snapshot={snapshot}
          selfId={selfId}
          radiusX={layout.ringRadiusX}
          radiusY={layout.ringRadiusY}
          cardScale={layout.cardScale}
        />

        <div className="flex flex-col items-center gap-6">
          {phase.name === 'starting' ? (
            <Countdown endsAt={phase.endsAt} pausedAt={snapshot.pausedAt} />
          ) : phase.name === 'turn' ? (
            <Bomb
              progress={progress}
              visualProgress={visualProgress}
              intensity={intensity}
              remainingMs={remainingMs}
              syllable={phase.syllable.toUpperCase()}
              exploding={false}
              reducedMotion={reducedMotion}
              size={layout.bombSize}
            />
          ) : phase.name === 'exploded' ? (
            <Bomb
              progress={1}
              visualProgress={1}
              intensity={1}
              remainingMs={0}
              syllable={phase.syllable.toUpperCase()}
              exploding={exploding || true}
              reducedMotion={reducedMotion}
              size={layout.bombSize}
            />
          ) : null}

        </div>
      </div>

      <div
        className="absolute left-1/2 z-10 w-full max-w-md -translate-x-1/2 px-4"
        style={{ bottom: layout.mode === 'compact' ? '3.5rem' : '5rem' }}
      >
        <WordInput
          enabled={myTurn}
          playerId={selfId}
          rejection={myTurn ? rejection : null}
          onTyping={(text) => {
            if (selfId === null) return;
            onSend({ type: 'TYPING', playerId: selfId, text });
          }}
          onSubmit={(word) => {
            if (selfId === null) return;
            onSend({ type: 'SUBMIT_WORD', playerId: selfId, word });
          }}
        />
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 space-y-1 text-center">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-riseFade font-display text-lg font-semibold"
            style={{
              color:
                toast.kind === 'accept'
                  ? 'var(--bp-good)'
                  : toast.kind === 'reject'
                    ? 'var(--bp-bad)'
                    : 'var(--bp-accent-soft)',
            }}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <Chat
        messages={snapshot.chat}
        selfId={selfId}
        enabled={snapshot.rules.chatEnabled}
        muted={myTurn}
        isHost={isHost}
        placement={layout.chat}
        onSend={(text) => {
          if (selfId === null) return;
          onSend({ type: 'SEND_CHAT', playerId: selfId, text });
        }}
        onKick={(playerId) => onHostIntent({ type: 'REMOVE_PLAYER', playerId })}
      />

      <FuseBar progress={progress} visible={phase.name === 'turn'} />

      {paused ? <PauseOverlay canResume={pausable} onResume={togglePause} /> : null}

      {confirmLeave ? (
        <LeaveConfirm onCancel={() => setConfirmLeave(false)} onConfirm={onLeave} />
      ) : null}
    </div>
  );
};

/**
 * The local player's alphabet progress.
 *
 * Rendered straight from the authoritative snapshot rather than from any local
 * tally, so it cannot drift from the engine: the reducer owns which letters are
 * marked, and this only draws them.
 */
const AlphabetTrack = ({
  snapshot,
  selfId,
  placement,
}: {
  snapshot: GameSnapshot;
  selfId: PlayerId | null;
  placement: AlphabetPlacement;
}) => {
  if (!snapshot.rules.alphabetBonusEnabled) return null;

  const me = snapshot.players.find((p) => p.id === selfId);
  if (me === undefined) return null;

  const required = requiredAlphabet(snapshot.rules);
  const used = new Set(me.stats.alphabetUsed);
  const collected = required.filter((ch) => used.has(ch)).length;

  return (
    <aside
      className={
        placement === 'rail'
          ? 'absolute left-5 top-1/2 z-10 -translate-y-1/2 select-none'
          : 'absolute left-1/2 top-14 z-10 w-[min(92vw,30rem)] -translate-x-1/2 select-none'
      }
    >
      <div className="panel rounded-xl px-3 py-2">
        <div
          className="mb-1.5 text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--bp-muted)' }}
        >
          Alphabet
        </div>
        <div
          className={
            placement === 'rail'
              ? 'grid grid-cols-2 gap-x-2 gap-y-1'
              : 'flex flex-wrap justify-center gap-x-1.5 gap-y-0.5'
          }
        >
          {required.map((ch) => {
            const done = used.has(ch);
            return (
              <span
                key={ch}
                className="text-center font-display text-sm font-semibold transition-colors"
                style={{
                  color: done ? 'var(--bp-accent)' : 'var(--bp-muted)',
                  opacity: done ? 1 : 0.4,
                }}
              >
                {ch.toUpperCase()}
              </span>
            );
          })}
        </div>
        <div
          className={`mt-1.5 text-[10px] tabular-nums ${placement === 'strip' ? 'text-center' : ''}`}
          style={{ color: 'var(--bp-muted)' }}
        >
          {collected}/{required.length} · +{snapshot.rules.alphabetBonusLives} life
        </div>
      </div>
    </aside>
  );
};

const LeaveConfirm = ({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div
    className="absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm"
    style={{ background: 'rgba(7, 7, 13, 0.72)' }}
  >
    <div className="panel w-[22rem] rounded-2xl p-6 text-center">
      <h2 className="font-display text-2xl font-semibold">Leave Game?</h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--bp-muted)' }}>
        Your current match will end.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button className="panel rounded-lg px-5 py-2.5" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="rounded-lg px-6 py-2.5 font-semibold text-black transition-transform hover:scale-[1.03]"
          style={{ background: 'var(--bp-bad)' }}
          onClick={onConfirm}
        >
          Leave
        </button>
      </div>
    </div>
  </div>
);

const PauseOverlay = ({
  canResume,
  onResume,
}: {
  canResume: boolean;
  onResume: () => void;
}) => (
  <div
    className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 backdrop-blur-sm"
    style={{ background: 'rgba(7, 7, 13, 0.72)' }}
  >
    <h2 className="font-display text-6xl font-bold" style={{ color: 'var(--bp-accent)' }}>
      Paused
    </h2>
    {canResume ? (
      <>
        <button
          className="rounded-lg px-8 py-3 font-semibold text-black transition-transform hover:scale-[1.03]"
          style={{ background: 'var(--bp-accent)' }}
          onClick={onResume}
        >
          Resume
        </button>
        <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--bp-muted)' }}>
          or press Esc
        </span>
      </>
    ) : (
      <span className="text-sm" style={{ color: 'var(--bp-muted)' }}>
        The host paused the game.
      </span>
    )}
  </div>
);

const FuseBar = ({ progress, visible }: { progress: number; visible: boolean }) => (
  <div className="absolute bottom-0 left-0 h-1 w-full bg-white/5">
    <div
      className="h-full transition-[width] duration-75 ease-linear"
      style={{
        width: visible ? `${Math.max(0, 100 - progress * 100)}%` : '0%',
        background: progress > 0.75 ? 'var(--bp-bad)' : 'var(--bp-fuse)',
        boxShadow: '0 0 18px 1px currentColor',
      }}
    />
  </div>
);

const secondsLeft = (endsAt: number, pausedAt: number | null): number =>
  Math.max(0, Math.ceil((endsAt - (pausedAt ?? Date.now())) / 1000));

/**
 * The pre-match countdown.
 *
 * Previously this computed a value once and never re-rendered, so it displayed
 * "3" for the whole three seconds. It now ticks, but it is still not a
 * decorative animation: every frame is derived from the authoritative
 * phase.endsAt, and the engine alone decides when the first turn begins, so the
 * display cannot disagree with the game state.
 *
 * Exactly one interval exists, owned by this component and cleared on unmount
 * or whenever the deadline changes, so a phase change cannot leave a second
 * timer running behind it.
 */
const Countdown = ({ endsAt, pausedAt }: { endsAt: number; pausedAt: number | null }) => {
  const [remaining, setRemaining] = useState(() => secondsLeft(endsAt, pausedAt));

  useEffect(() => {
    setRemaining(secondsLeft(endsAt, pausedAt));
    // Frozen while paused: the deadline is shifted forward on resume, so there
    // is nothing to count down in the meantime.
    if (pausedAt !== null) return;

    const handle = setInterval(() => setRemaining(secondsLeft(endsAt, null)), 50);
    return () => clearInterval(handle);
  }, [endsAt, pausedAt]);

  return (
    <div className="font-display text-8xl font-bold" style={{ color: 'var(--bp-accent)' }}>
      {remaining > 0 ? remaining : 'GO!'}
    </div>
  );
};
