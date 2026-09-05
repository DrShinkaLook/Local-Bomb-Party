import { useEffect, useRef, useState } from 'react';
import type { PlayerId } from '@bombparty/engine';

/**
 * The player's input box.
 *
 * Two behaviours worth calling out. Keystrokes are mirrored to the room as
 * `TYPING` intents so spectators see the word forming — the tension of watching
 * someone type is most of the game. And the field is only enabled on the
 * player's own turn: the host would reject anything else anyway, but a disabled
 * field says so without a round trip.
 */

interface WordInputProps {
  readonly enabled: boolean;
  readonly playerId: PlayerId | null;
  readonly rejection: string | null;
  readonly onTyping: (text: string) => void;
  readonly onSubmit: (word: string) => void;
}

export const WordInput = ({ enabled, playerId, rejection, onTyping, onSubmit }: WordInputProps) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (enabled) inputRef.current?.focus();
    else setValue('');
  }, [enabled]);

  useEffect(() => {
    if (rejection === null) return;
    setShake(true);
    const timer = setTimeout(() => setShake(false), 320);
    return () => clearTimeout(timer);
  }, [rejection]);

  if (playerId === null) return null;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <input
        ref={inputRef}
        className={[
          'word-input panel w-full rounded-xl bg-black/30 px-5 py-3 text-center font-display text-2xl',
          'tracking-wide outline-none transition-all',
          enabled ? '' : 'cursor-not-allowed opacity-40',
          shake ? 'animate-[shake_320ms_ease-in-out]' : '',
        ].join(' ')}
        style={{
          borderColor: rejection !== null ? 'var(--bp-bad)' : 'var(--bp-panel-edge)',
          ['--shake' as string]: '4px',
        }}
        value={value}
        disabled={!enabled}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        placeholder={enabled ? 'type a word…' : 'waiting…'}
        aria-label="Your word"
        onChange={(event) => {
          // Letters only, mirrored upstream. Filtering here keeps the host's
          // NON_ALPHABETIC rejection for cases that actually matter (a pasted
          // string) rather than firing on every stray keystroke.
          const next = event.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 32);
          setValue(next);
          onTyping(next);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          const word = value.trim();
          if (word.length === 0) return;
          onSubmit(word);
          setValue('');
        }}
      />
      <div className="h-4 text-xs" style={{ color: 'var(--bp-bad)' }}>
        {rejection ?? ''}
      </div>
    </div>
  );
};
