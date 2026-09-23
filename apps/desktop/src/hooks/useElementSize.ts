import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Measure an element, and keep measuring it.
 *
 * `ResizeObserver` rather than a window resize listener: the stage is a box
 * inside the window, and on a phone it will change size for reasons the window
 * never hears about — a keyboard opening, a rotation, a browser chrome bar
 * collapsing. Observing the element itself is the version of this that keeps
 * working outside a desktop window.
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The return type is `RefObject<T>`, not `RefObject<T | null>`.
 *
 * They expand to the same shape — React 18's RefObject is
 * `{ readonly current: T | null }` — but TypeScript compares generics by
 * variance before it compares structure. RefObject is covariant in T, so
 * `RefObject<HTMLDivElement | null>` is rejected where `RefObject<HTMLDivElement>`
 * is wanted, because `HTMLDivElement | null` is not assignable to
 * `HTMLDivElement`. Using the `useRef<T>(null)` overload sidesteps it and is
 * the shape React's own `ref` prop expects.
 *
 * `ref.current` is still `T | null` at the use site, which the effect handles.
 */
export const useElementSize = <T extends HTMLElement>(): [RefObject<T>, Size] => {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      // Round before comparing: sub-pixel jitter would otherwise re-render the
      // whole stage on every scrollbar twitch.
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
};
