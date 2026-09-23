import { useEffect, useState } from 'react';
import { AVATARS, PLAYER_COLORS, allPlayersReady } from '@bombparty/engine';
import type { BotDifficulty, GameSnapshot, Intent, PlayerId } from '@bombparty/engine';

interface LobbyProps {
  readonly snapshot: GameSnapshot;
  readonly selfId: PlayerId | null;
  readonly isHost: boolean;
  readonly lanPort: number | null;
  readonly onHostIntent: (intent: Intent) => void;
  /** Self-owned intents: readiness, appearance, renaming yourself. */
  readonly onSend: (intent: Intent) => void;
  readonly onLeave: () => void;
}

export const Lobby = ({
  snapshot,
  selfId,
  isHost,
  lanPort,
  onHostIntent,
  onSend,
  onLeave,
}: LobbyProps) => {
  const rules = snapshot.rules;
  const me = snapshot.players.find((p) => p.id === selfId) ?? null;
  const everyoneReady = allPlayersReady(snapshot);
  const full = snapshot.players.length >= rules.playerLimit;

  return (
    <div className="stage flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto p-4 sm:gap-8 sm:p-10">
      <div className="grid w-full max-w-5xl grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
        <section className="panel rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">
              Players{' '}
              <span className="text-sm font-normal" style={{ color: 'var(--bp-muted)' }}>
                {snapshot.players.length}/{rules.playerLimit}
              </span>
            </h2>
            {lanPort !== null ? (
              <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--bp-muted)' }}>
                <span>
                  Code{' '}
                  <span
                    className="font-mono text-sm tracking-[0.25em]"
                    style={{ color: 'var(--bp-accent)' }}
                  >
                    {snapshot.roomCode}
                  </span>
                </span>
                <span>port {lanPort}</span>
              </span>
            ) : null}
          </div>

          <ul className="mt-4 space-y-2">
            {[...snapshot.players]
              .sort((a, b) => a.seat - b.seat)
              .map((player) => (
                <li
                  key={player.id}
                  className="panel flex items-center justify-between rounded-lg px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm"
                      style={{ background: `${player.color}22`, border: `1px solid ${player.color}` }}
                      aria-hidden
                    >
                      {player.avatar}
                    </span>
                    {(isHost && player.kind.type === 'bot') || player.id === selfId ? (
                      <EditableName
                        value={player.name}
                        onCommit={(name) =>
                          // Your own name is yours to change; a bot's belongs
                          // to the host. Both land on the same intent, but from
                          // different authority.
                          (player.id === selfId ? onSend : onHostIntent)({
                            type: 'RENAME_PLAYER',
                            playerId: player.id,
                            name,
                          })
                        }
                      />
                    ) : (
                      <span className="font-medium">{player.name}</span>
                    )}
                    {player.id === selfId ? (
                      <span className="rounded bg-white/10 px-1.5 text-[10px] uppercase">you</span>
                    ) : null}
                    {player.kind.type === 'human' && player.ready ? (
                      <span
                        className="rounded px-1.5 text-[10px] uppercase"
                        style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--bp-accent)' }}
                      >
                        ready
                      </span>
                    ) : null}
                    {player.kind.type === 'bot' ? (
                      <span
                        className="rounded px-1.5 text-[10px] uppercase"
                        style={{
                          background: 'rgba(var(--bp-accent-rgb), 0.15)',
                          color: 'var(--bp-accent-soft)',
                        }}
                      >
                        {player.kind.difficulty}
                      </span>
                    ) : null}
                  </span>
                  {isHost && player.id !== selfId ? (
                    <button
                      className="text-xs uppercase tracking-wide hover:underline"
                      style={{ color: 'var(--bp-muted)' }}
                      onClick={() => onHostIntent({ type: 'REMOVE_PLAYER', playerId: player.id })}
                    >
                      remove
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>

          {isHost ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {(['easy', 'medium', 'hard', 'impossible'] as BotDifficulty[]).map((difficulty) => (
                <button
                  key={difficulty}
                  className="panel rounded-lg px-3 py-2 text-sm capitalize transition-colors hover:bg-white/5 disabled:opacity-40"
                  disabled={full}
                  onClick={() => onHostIntent({ type: 'ADD_BOT', difficulty })}
                >
                  + {difficulty} bot
                </button>
              ))}
            </div>
          ) : null}
          {me !== null ? (
            <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--bp-panel-edge)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--bp-muted)' }}>
                  You
                </span>
                <button
                  className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors"
                  style={
                    me.ready
                      ? { background: 'var(--bp-accent)', color: '#000' }
                      : { border: '1px solid var(--bp-panel-edge)', color: 'var(--bp-text)' }
                  }
                  aria-pressed={me.ready}
                  onClick={() => onSend({ type: 'SET_READY', playerId: me.id, ready: !me.ready })}
                >
                  {me.ready ? 'Ready' : 'Not ready'}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {AVATARS.map((avatar) => (
                  <button
                    key={avatar}
                    className="grid h-7 w-7 place-items-center rounded text-sm transition-colors hover:bg-white/10"
                    style={me.avatar === avatar ? { background: 'rgba(255,255,255,0.14)' } : undefined}
                    aria-label={`Avatar ${avatar}`}
                    aria-pressed={me.avatar === avatar}
                    onClick={() => onSend({ type: 'SET_APPEARANCE', playerId: me.id, avatar })}
                  >
                    {avatar}
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {PLAYER_COLORS.map((color) => (
                  <button
                    key={color}
                    className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: color,
                      outline: me.color === color ? '2px solid var(--bp-text)' : 'none',
                      outlineOffset: '2px',
                    }}
                    aria-label={`Colour ${color}`}
                    aria-pressed={me.color === color}
                    onClick={() => onSend({ type: 'SET_APPEARANCE', playerId: me.id, color })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel rounded-2xl p-6">
          <h2 className="font-display text-xl font-semibold">Rules</h2>
          <div className="mt-4 space-y-3 text-sm">
            <RuleRow
              label="Starting lives"
              value={rules.startingLives}
              editable={isHost}
              min={1}
              max={5}
              onChange={(v) => onHostIntent({ type: 'SET_RULES', rules: { startingLives: v } })}
            />
            <RuleRow
              label="Shortest fuse (s)"
              value={Math.round(rules.minBombMs / 1000)}
              editable={isHost}
              min={2}
              max={20}
              onChange={(v) =>
                onHostIntent({
                  type: 'SET_RULES',
                  rules: { minBombMs: v * 1000, maxBombMs: Math.max(v * 1000, rules.maxBombMs) },
                })
              }
            />
            <RuleRow
              label="Longest fuse (s)"
              value={Math.round(rules.maxBombMs / 1000)}
              editable={isHost}
              min={2}
              max={30}
              onChange={(v) =>
                onHostIntent({
                  type: 'SET_RULES',
                  rules: { maxBombMs: v * 1000, minBombMs: Math.min(v * 1000, rules.minBombMs) },
                })
              }
            />
            <ToggleRow
              label="Alphabet bonus"
              value={rules.alphabetBonusEnabled}
              editable={isHost}
              onChange={(v) =>
                onHostIntent({ type: 'SET_RULES', rules: { alphabetBonusEnabled: v } })
              }
            />
            {rules.alphabetBonusEnabled ? (
              <RuleRow
                label="Hearts per alphabet"
                value={rules.alphabetBonusLives}
                editable={isHost}
                min={1}
                max={3}
                onChange={(v) =>
                  onHostIntent({ type: 'SET_RULES', rules: { alphabetBonusLives: v } })
                }
              />
            ) : null}
            <RuleRow
              label="Player limit"
              value={rules.playerLimit}
              editable={isHost}
              min={Math.max(2, snapshot.players.length)}
              max={16}
              onChange={(v) => onHostIntent({ type: 'SET_RULES', rules: { playerLimit: v } })}
            />
            <ToggleRow
              label="Bomb acceleration"
              value={rules.bombAccelerationEnabled}
              editable={isHost}
              onChange={(v) =>
                onHostIntent({ type: 'SET_RULES', rules: { bombAccelerationEnabled: v } })
              }
            />
            <ToggleRow
              label="Chat"
              value={rules.chatEnabled}
              editable={isHost}
              onChange={(v) => onHostIntent({ type: 'SET_RULES', rules: { chatEnabled: v } })}
            />
            <RuleRow
              label="Minimum word length"
              value={rules.minWordLength}
              editable={isHost}
              min={2}
              max={8}
              onChange={(v) => onHostIntent({ type: 'SET_RULES', rules: { minWordLength: v } })}
            />
          </div>
        </section>
      </div>

      <div className="flex gap-3">
        <button className="panel rounded-lg px-5 py-3" onClick={onLeave}>
          Leave
        </button>
        {isHost ? (
          <button
            className="rounded-lg px-8 py-3 font-semibold text-black transition-transform hover:scale-[1.03] disabled:opacity-40"
            style={{ background: 'var(--bp-accent)' }}
            disabled={snapshot.players.length < 2}
            title={everyoneReady ? undefined : 'Some players are not ready yet'}
            onClick={() => onHostIntent({ type: 'START_GAME' })}
          >
            {snapshot.players.length < 2
              ? 'Need 2 players'
              : everyoneReady
                ? 'Start game'
                : 'Start anyway'}
          </button>
        ) : (
          <span className="px-5 py-3 text-sm" style={{ color: 'var(--bp-muted)' }}>
            Waiting for the host to start…
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * A bot name, edited in place.
 *
 * The draft is local so a keystroke does not become an intent — only the
 * committed value is sent, on blur or Enter, and Escape reverts. If the host
 * refuses the name (blank, or too long) the snapshot simply never changes and
 * the field resyncs from it, so the field can never disagree with the game.
 */
const EditableName = ({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = (): void => {
    setEditing(false);
    const clean = draft.trim();
    if (clean.length > 0 && clean !== value) onCommit(clean);
    else setDraft(value);
  };

  return (
    <input
      className="w-32 rounded bg-transparent px-1 font-medium outline-none transition-colors hover:bg-white/5 focus:bg-white/10"
      value={draft}
      maxLength={24}
      spellCheck={false}
      aria-label={`Rename ${value}`}
      title="Click to rename this bot"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
};

const ToggleRow = ({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: boolean;
  editable: boolean;
  onChange: (value: boolean) => void;
}) => (
  <div className="flex items-center justify-between">
    <span style={{ color: 'var(--bp-muted)' }}>{label}</span>
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={!editable}
      className="h-6 w-11 rounded-full transition-colors disabled:opacity-40"
      style={{ background: value ? 'var(--bp-accent)' : 'rgba(255,255,255,0.15)' }}
      onClick={() => onChange(!value)}
    >
      <span
        className="block h-5 w-5 rounded-full bg-white transition-transform"
        style={{ transform: value ? 'translateX(1.4rem)' : 'translateX(0.15rem)' }}
      />
    </button>
  </div>
);

interface RuleRowProps {
  readonly label: string;
  readonly value: number;
  readonly editable: boolean;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

const RuleRow = ({ label, value, editable, min, max, onChange }: RuleRowProps) => (
  <div className="flex items-center justify-between">
    <span style={{ color: 'var(--bp-muted)' }}>{label}</span>
    {editable ? (
      <span className="flex items-center gap-2">
        <button
          className="panel h-7 w-7 rounded"
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`decrease ${label}`}
        >
          −
        </button>
        <span className="w-8 text-center tabular-nums">{value}</span>
        <button
          className="panel h-7 w-7 rounded"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`increase ${label}`}
        >
          +
        </button>
      </span>
    ) : (
      <span className="tabular-nums">{value}</span>
    )}
  </div>
);
