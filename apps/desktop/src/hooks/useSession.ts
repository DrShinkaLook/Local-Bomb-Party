import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requiredAlphabet } from '@bombparty/engine';
import type { GameEvent, GameSnapshot, Intent, PlayerId, ValidationFailure } from '@bombparty/engine';
import { sfx } from '../audio/sfx.js';

/**
 * The renderer's whole relationship with the game.
 *
 * React holds no game logic at all. It holds the latest snapshot the host sent,
 * a little transient presentation state (the flash after a rejected word), and
 * a `send` function. Every state change arrives as an event from the host —
 * which means the UI is correct in single-player and LAN for the same reason,
 * and there is no client-side rule to fall out of sync.
 */

export interface Toast {
  readonly id: number;
  readonly kind: 'accept' | 'reject' | 'info';
  readonly text: string;
}

export interface SessionState {
  readonly snapshot: GameSnapshot | null;
  readonly playerId: PlayerId | null;
  readonly toasts: readonly Toast[];
  readonly lastRejection: string | null;
  readonly explosionAt: number | null;
}

export const useSession = (playerId: PlayerId | null) => {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastRejection, setLastRejection] = useState<string | null>(null);
  const [explosionAt, setExplosionAt] = useState<number | null>(null);
  const toastId = useRef(0);
  const collectedRef = useRef<number | null>(null);

  const pushToast = useCallback((kind: Toast['kind'], text: string) => {
    toastId.current += 1;
    const toast: Toast = { id: toastId.current, kind, text };
    setToasts((current) => [...current.slice(-4), toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== toast.id));
    }, 1_400);
  }, []);

  useEffect(() => {
    let cancelled = false;

    /**
     * The engine emits no "letter collected" event — collecting one is a
     * consequence of an accepted word, not a rule — so the cue is derived by
     * watching the local player's tracker across snapshots.
     *
     * Local player only: in a sixteen-player room, announcing everyone's
     * letters would be a constant chatter with no information in it.
     */
    const announceLetters = (next: GameSnapshot): void => {
      if (playerId === null) return;
      const me = next.players.find((p) => p.id === playerId);
      if (me === undefined) return;

      // Counted the same way the tracker draws it: letters that are both
      // required and used, so a letter outside the required set is silent.
      const required = requiredAlphabet(next.rules);
      const used = new Set(me.stats.alphabetUsed);
      const collected = required.filter((ch) => used.has(ch)).length;

      const previous = collectedRef.current;
      collectedRef.current = collected;

      // The first snapshot only establishes a baseline. A decrease is the
      // tracker resetting after a heart, which LIFE_GAINED already announces.
      if (previous === null || collected <= previous) return;
      sfx.play('letter', collected / Math.max(1, required.length));
    };

    void window.bombParty.getSnapshot().then((initial) => {
      if (!cancelled && initial !== null) setSnapshot(initial);
    });

    const off = window.bombParty.onEvent((event: GameEvent) => {
      switch (event.type) {
        case 'STATE_SYNC':
          setSnapshot(event.snapshot);
          announceLetters(event.snapshot);
          return;

        case 'TURN_STARTED':
          setLastRejection(null);
          sfx.play('turnStart');
          return;

        case 'BOMB_TICK': {
          const fraction = 1 - event.remainingMs / Math.max(1, event.totalMs);
          // Tick rate accelerates with the fuse: every 500ms at the start,
          // every 100ms at the end. Derived from the event rather than a
          // timer of the renderer's own, so audio cannot drift from the bar.
          const interval = 500 - fraction * 400;
          if (event.remainingMs % interval < 110) sfx.play('tick', fraction);
          return;
        }

        case 'WORD_SUBMITTED':
          if (event.result.ok) {
            sfx.play('accept');
            pushToast('accept', event.word);
          } else {
            sfx.play('reject');
            setLastRejection(REJECTION_TEXT[event.result.reason]);
            if (event.playerId !== playerId) {
              pushToast('reject', `${event.word}?`);
            }
          }
          return;

        case 'PLAYER_EXPLODED':
          sfx.play('explode');
          setExplosionAt(Date.now());
          setTimeout(() => setExplosionAt(null), 900);
          return;

        case 'PLAYER_ELIMINATED':
          sfx.play('eliminate');
          return;

        case 'LIFE_GAINED':
          sfx.play('lifeGained');
          pushToast('info', 'Alphabet bonus — extra life');
          return;

        case 'GAME_OVER':
          sfx.play('victory');
          return;

        case 'ERROR':
          pushToast('reject', event.message);
          return;

        default:
          return;
      }
    });

    return () => {
      cancelled = true;
      off();
    };
  }, [playerId, pushToast]);

  const send = useCallback((intent: Intent) => {
    void window.bombParty.sendIntent(intent);
  }, []);

  const hostSend = useCallback((intent: Intent) => {
    void window.bombParty.hostIntent(intent);
  }, []);

  const state: SessionState = useMemo(
    () => ({ snapshot, playerId, toasts, lastRejection, explosionAt }),
    [snapshot, playerId, toasts, lastRejection, explosionAt],
  );

  return { ...state, send, hostSend, pushToast };
};

const REJECTION_TEXT: Record<ValidationFailure, string> = {
  EMPTY: 'Type something',
  TOO_SHORT: 'Too short',
  NON_ALPHABETIC: 'Letters only',
  MISSING_SYLLABLE: "Doesn't contain the syllable",
  NOT_A_WORD: 'Not in the dictionary',
  ALREADY_USED: 'Already played this round',
};
