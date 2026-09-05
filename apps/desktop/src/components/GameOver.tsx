import type { GameSnapshot, Intent, PlayerId } from '@bombparty/engine';

interface GameOverProps {
  readonly snapshot: GameSnapshot;
  readonly winner: PlayerId | null;
  readonly isHost: boolean;
  readonly onHostIntent: (intent: Intent) => void;
  readonly onLeave: () => void;
}

export const GameOver = ({ snapshot, winner, isHost, onHostIntent, onLeave }: GameOverProps) => {
  const champion = snapshot.players.find((p) => p.id === winner) ?? null;
  const ranked = [...snapshot.players].sort(
    (a, b) => b.stats.wordsPlayed - a.stats.wordsPlayed || b.lives - a.lives,
  );

  return (
    <div className="stage flex h-full w-full flex-col items-center justify-center gap-8 p-10">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--bp-muted)' }}>
          Game over
        </p>
        <h2 className="mt-2 font-display text-5xl font-bold" style={{ color: 'var(--bp-accent)' }}>
          {champion !== null ? `${champion.name} wins` : 'Nobody wins'}
        </h2>
      </div>

      <table className="panel w-full max-w-2xl rounded-2xl text-sm">
        <thead>
          <tr style={{ color: 'var(--bp-muted)' }}>
            <th className="px-4 py-3 text-left font-medium">Player</th>
            <th className="px-4 py-3 text-right font-medium">Words</th>
            <th className="px-4 py-3 text-right font-medium">Letters</th>
            <th className="px-4 py-3 text-right font-medium">Longest</th>
            <th className="px-4 py-3 text-right font-medium">Bombs</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((player) => (
            <tr key={player.id} className="border-t" style={{ borderColor: 'var(--bp-panel-edge)' }}>
              <td className="px-4 py-2.5">
                {player.name}
                {player.id === winner ? (
                  <span className="ml-2" style={{ color: 'var(--bp-fuse)' }}>
                    ★
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{player.stats.wordsPlayed}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{player.stats.lettersUsed}</td>
              <td className="px-4 py-2.5 text-right font-mono">{player.stats.longestWord || '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{player.stats.turnsExploded}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex gap-3">
        <button className="panel rounded-lg px-5 py-3" onClick={onLeave}>
          Back to menu
        </button>
        {isHost ? (
          <button
            className="rounded-lg px-6 py-3 font-semibold text-black"
            style={{ background: 'var(--bp-accent)' }}
            onClick={() => onHostIntent({ type: 'RESET_TO_LOBBY' })}
          >
            Play again
          </button>
        ) : null}
      </div>
    </div>
  );
};
