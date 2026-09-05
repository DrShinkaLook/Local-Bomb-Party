import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '@bombparty/engine';

/**
 * Turns the authoritative `bombEndsAt` into a smooth 0..1 progress value.
 *
 * The host does not stream the countdown — it sends an absolute deadline once,
 * at turn start. The renderer interpolates against its own animation frames,
 * which is why the bar is smooth at 60fps while the network carries a handful
 * of messages per turn.
 *
 * Clock skew between machines shifts the whole bar by the offset, it does not
 * change who explodes: the host alone decides that, and it decides it from its
 * own clock.
 */
export const useFuse = (snapshot: GameSnapshot | null): { progress: number; remainingMs: number } => {
  const [value, setValue] = useState({ progress: 0, remainingMs: 0 });
  const frame = useRef<number | null>(null);
  const skew = useRef(0);

  useEffect(() => {
    if (snapshot === null) return;
    // One-shot skew estimate per snapshot: the difference between the host's
    // stated time and ours. Averaged loosely to avoid the bar jittering when a
    // snapshot arrives late.
    const observed = Date.now() - snapshot.serverTime;
    skew.current = skew.current * 0.8 + observed * 0.2;
  }, [snapshot]);

  useEffect(() => {
    if (snapshot === null || snapshot.phase.name !== 'turn') {
      setValue({ progress: 0, remainingMs: 0 });
      return;
    }
    const { bombEndsAt, bombTotalMs } = snapshot.phase;

    // Paused: hold the bar exactly where the host stopped it. Both timestamps
    // are host-clock, so this needs no skew correction — and without it local
    // animation frames would happily run the bar to zero while the game is
    // frozen, showing an explosion that is not going to happen.
    if (snapshot.pausedAt !== null) {
      const frozenMs = Math.max(0, bombEndsAt - snapshot.pausedAt);
      setValue({ progress: 1 - frozenMs / bombTotalMs, remainingMs: frozenMs });
      return;
    }

    const step = (): void => {
      const now = Date.now() - skew.current;
      const remainingMs = Math.max(0, bombEndsAt - now);
      setValue({ progress: 1 - remainingMs / bombTotalMs, remainingMs });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [snapshot]);

  return value;
};
