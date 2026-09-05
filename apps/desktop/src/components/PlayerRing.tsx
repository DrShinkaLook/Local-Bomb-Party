import type { GameSnapshot, Player, PlayerId } from '@bombparty/engine';

/**
 * Players arranged around the bomb.
 *
 * Seat order is the turn order, so the ring is laid out by seat rather than by
 * array position — that keeps the rotation stable when someone leaves.
 */

interface PlayerRingProps {
  readonly snapshot: GameSnapshot;
  readonly selfId: PlayerId | null;
  readonly radius?: number;
}

export const PlayerRing = ({ snapshot, selfId, radius = 260 }: PlayerRingProps) => {
  const seated = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const active = snapshot.phase.name === 'turn' ? snapshot.phase.currentPlayer : null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {seated.map((player, index) => {
        // Start at the bottom and go clockwise, so the local player's usual
        // seat reads as "nearest the camera".
        const angle = (index / Math.max(1, seated.length)) * Math.PI * 2 + Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.62;

        return (
          <div
            key={player.id}
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
          >
            <PlayerCard
              player={player}
              isActive={player.id === active}
              isSelf={player.id === selfId}
              typing={player.id === active ? snapshot.typing : ''}
            />
          </div>
        );
      })}
    </div>
  );
};

interface PlayerCardProps {
  readonly player: Player;
  readonly isActive: boolean;
  readonly isSelf: boolean;
  readonly typing: string;
}

const PlayerCard = ({ player, isActive, isSelf, typing }: PlayerCardProps) => {
  const eliminated = player.lives === 0;

  return (
    <div
      className={[
        'panel relative w-40 rounded-xl px-3 py-2 text-center transition-all duration-200',
        isActive ? 'scale-110 shadow-[0_0_40px_-6px_var(--bp-accent)]' : '',
        eliminated ? 'opacity-35 grayscale' : '',
      ].join(' ')}
      style={{
        borderColor: isActive ? 'var(--bp-accent)' : 'var(--bp-panel-edge)',
      }}
    >
      {isActive ? (
        <span
          className="absolute inset-0 -z-10 rounded-xl"
          style={{ boxShadow: 'var(--bp-glow)' }}
          aria-hidden
        />
      ) : null}

      <div className="flex items-center justify-center gap-1.5">
        <span className="truncate text-sm font-semibold" title={player.name}>
          {player.name}
        </span>
        {isSelf ? (
          <span className="rounded bg-white/10 px-1 text-[10px] uppercase tracking-wide">you</span>
        ) : null}
      </div>

      <div className="mt-1 flex items-center justify-center gap-1" aria-label={`${player.lives} lives`}>
        {Array.from({ length: Math.max(player.lives, 0) }).map((_, i) => (
          <Heart key={i} />
        ))}
        {eliminated ? (
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--bp-muted)' }}>
            out
          </span>
        ) : null}
      </div>

      <div className="mt-1 h-4 truncate font-mono text-xs" style={{ color: 'var(--bp-accent-soft)' }}>
        {isActive ? typing : player.kind.type === 'bot' ? player.kind.difficulty : ''}
      </div>

      <AlphabetMeter used={player.stats.alphabetUsed.length} />
    </div>
  );
};

const Heart = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
    <path
      d="M12 21s-7.5-4.7-9.6-9.1C.7 8.4 2.6 5 6 5c2 0 3.4 1.1 4 2.1C10.6 6.1 12 5 14 5c3.4 0 5.3 3.4 3.6 6.9C19.5 16.3 12 21 12 21z"
      fill="var(--bp-bad)"
    />
  </svg>
);

/** Progress toward the alphabet bonus. Twenty-six thin ticks. */
const AlphabetMeter = ({ used }: { used: number }) => (
  <div className="mt-1.5 flex h-1 gap-[1px]">
    {Array.from({ length: 26 }).map((_, i) => (
      <span
        key={i}
        className="flex-1 rounded-full"
        style={{ background: i < used ? 'var(--bp-good)' : 'rgba(255,255,255,0.08)' }}
      />
    ))}
  </div>
);
