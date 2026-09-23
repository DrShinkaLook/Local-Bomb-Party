import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT_LENGTH, type ChatMessage, type PlayerId } from '@bombparty/engine';
import type { ChatPlacement } from '../layout/stage.js';

/**
 * Room chat, embedded in the game screen.
 *
 * Placement is the whole design problem. The bomb owns the centre, the player
 * ring orbits it, the alphabet tracker holds the left edge and the word input
 * sits bottom-centre — so chat takes the bottom-right corner, stays narrow,
 * and can be collapsed to a single bar. Nothing it covers is load-bearing, and
 * a player who finds it in the way can fold it away in one click.
 *
 * It reads from the snapshot, so it is the same code in single-player and on a
 * LAN: messages arrive through the state the host already broadcasts.
 */

interface ChatProps {
  readonly messages: readonly ChatMessage[];
  readonly selfId: PlayerId | null;
  readonly enabled: boolean;
  /** True on your own turn — the keyboard belongs to the bomb word then. */
  readonly muted: boolean;
  readonly isHost: boolean;
  /** 'docked' floats bottom-right; 'sheet' spans the bottom edge. */
  readonly placement: ChatPlacement;
  readonly onSend: (text: string) => void;
  readonly onKick: (playerId: PlayerId) => void;
}

export const Chat = ({
  messages,
  selfId,
  enabled,
  muted,
  isHost,
  placement,
  onSend,
  onKick,
}: ChatProps) => {
  // A floating panel has room to stand open; a bottom sheet is in the way of
  // the game until someone asks for it, so it starts folded.
  const [open, setOpen] = useState(placement === 'docked');
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Follow the tail. Keyed on the newest id rather than length so an eviction
  // (which leaves the length unchanged) still scrolls.
  const newestId = messages[messages.length - 1]?.id ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list === null || !open) return;
    list.scrollTop = list.scrollHeight;
  }, [newestId, open]);

  // Losing the turn hands the keyboard back; take focus so a player can reply
  // without reaching for the mouse.
  useEffect(() => {
    if (muted || !open) return;
    if (document.activeElement === document.body) inputRef.current?.focus();
  }, [muted, open]);

  if (!enabled) return null;

  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0) return;
    onSend(text);
    setDraft('');
  };

  return (
    <aside
      className={
        placement === 'docked'
          ? 'absolute bottom-4 right-4 z-10 w-64 select-none'
          : 'absolute bottom-0 left-0 right-0 z-10 select-none px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
      }
    >
      <div className="panel overflow-hidden rounded-xl">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest transition-colors hover:bg-white/5"
          style={{ color: 'var(--bp-muted)' }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>Chat</span>
          <span className="flex items-center gap-2">
            {!open && messages.length > 0 ? <span>{messages.length}</span> : null}
            <span aria-hidden>{open ? '▾' : '▴'}</span>
          </span>
        </button>

        {open ? (
          <>
            <div
              ref={listRef}
              className="scroll-thin max-h-40 space-y-1 overflow-y-auto px-3 pb-2"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <p className="py-2 text-xs" style={{ color: 'var(--bp-muted)' }}>
                  No messages yet.
                </p>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="group text-xs leading-snug">
                    <span
                      className="font-semibold"
                      style={{
                        color:
                          message.playerId === selfId
                            ? 'var(--bp-accent)'
                            : 'var(--bp-muted)',
                      }}
                    >
                      {message.name}
                    </span>
                    {isHost && message.playerId !== selfId ? (
                      <button
                        className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ color: 'var(--bp-bad)' }}
                        title={`Kick ${message.name}`}
                        aria-label={`Kick ${message.name}`}
                        onClick={() => onKick(message.playerId)}
                      >
                        ×
                      </button>
                    ) : null}
                    <span style={{ color: 'var(--bp-muted)' }}>: </span>
                    <span className="break-words">{message.text}</span>
                  </div>
                ))
              )}
            </div>

            <div className="border-t px-2 py-2" style={{ borderColor: 'var(--bp-panel-edge)' }}>
              <input
                ref={inputRef}
                className="w-full rounded bg-black/25 px-2 py-1 text-xs outline-none disabled:opacity-40"
                value={draft}
                disabled={muted}
                maxLength={MAX_CHAT_LENGTH}
                spellCheck={false}
                autoComplete="off"
                placeholder={muted ? 'Your turn — type your word' : 'Say something…'}
                aria-label="Chat message"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Stop Enter and Escape reaching the window handlers that own
                  // word submission and pause.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    submit();
                    return;
                  }
                  // Escape leaves the field rather than pausing the game;
                  // the window-level pause handler must not see it.
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    inputRef.current?.blur();
                  }
                }}
              />
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
};
