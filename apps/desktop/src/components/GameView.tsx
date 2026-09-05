import { useEffect } from 'react';
import type { GameSnapshot, Intent, PlayerId } from '@bombparty/engine';
import { Bomb } from './Bomb.js';
import { PlayerRing } from './PlayerRing.js';
import { WordInput } from './WordInput.js';
import { useFuse } from '../hooks/useFuse.js';
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
}: GameViewProps) => {
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

  // Shake intensity is a cubic of fuse progress, so the last second is
  // dramatically worse than the first — linear reads as a constant wobble.
  const shakePx = screenShake && !reducedMotion && !paused ? Math.pow(progress, 3) * 7 : 0;
  const shaking = shakePx > 0.4 && phase.name === 'turn';

  return (
    <div
      className={['stage relative h-full w-full overflow-hidden', shaking ? 'shakeable' : ''].join(' ')}
      style={{ ['--shake' as string]: `${shakePx}px` }}
    >
      <header className="absolute left-0 right-0 top-0 flex items-center justify-between px-6 py-4">
        <span className="font-display text-sm tracking-widest" style={{ color: 'var(--bp-muted)' }}>
          ROUND · {snapshot.usedWords.length} words played
        </span>
        <span className="flex items-center gap-4">
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
        </span>
      </header>

      <div className="relative flex h-full w-full items-center justify-center">
        <PlayerRing snapshot={snapshot} selfId={selfId} />

        <div className="flex flex-col items-center gap-6">
          {phase.name === 'starting' ? (
            <Countdown endsAt={phase.endsAt} />
          ) : phase.name === 'turn' ? (
            <Bomb
              progress={progress}
              remainingMs={remainingMs}
              syllable={phase.syllable.toUpperCase()}
              exploding={false}
              reducedMotion={reducedMotion}
            />
          ) : phase.name === 'exploded' ? (
            <Bomb
              progress={1}
              remainingMs={0}
              syllable={phase.syllable.toUpperCase()}
              exploding={exploding || true}
              reducedMotion={reducedMotion}
            />
          ) : null}

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
      </div>

      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 space-y-1 text-center">
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

      <FuseBar progress={progress} visible={phase.name === 'turn'} />

      {paused ? <PauseOverlay canResume={pausable} onResume={togglePause} /> : null}
    </div>
  );
};

const PauseOverlay = ({
  canResume,
  onResume,
}: {
  canResume: boolean;
  onResume: () => void;
}) => (
  <div
    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 backdrop-blur-sm"
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

const Countdown = ({ endsAt }: { endsAt: number }) => {
  const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return (
    <div className="font-display text-8xl font-bold" style={{ color: 'var(--bp-accent)' }}>
      {remaining > 0 ? remaining : 'GO'}
    </div>
  );
};
