/**
 * Global attribution mark.
 *
 * Mounted once at the app shell rather than per screen, so it appears on every
 * view without any screen having to remember it — and so changing the wording
 * is a one-line edit rather than a sweep.
 *
 * `pointer-events-none` is what keeps it honest: the mark sits above the layout
 * but can never intercept a click meant for a button underneath it, which is
 * the usual way a fixed-position footer breaks a UI. It is also hidden from
 * assistive tech on short viewports only by virtue of being decorative text —
 * the real copyright notice lives in LICENSE.txt, not here.
 */
export const BrandFooter = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none fixed bottom-2 right-3 z-50 select-none text-[11px] leading-none tracking-wide"
    style={{ color: 'var(--bp-muted)', opacity: 0.55 }}
  >
    Made by Kobi Dao · © 2026
  </div>
);
