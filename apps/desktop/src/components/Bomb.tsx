import { useEffect, useRef } from 'react';

/**
 * Accent green, as a raw RGB triple. Canvas has no access to the CSS variables
 * in index.css, so this is the one place the theme colour is duplicated; keep
 * it in step with `--bp-accent-rgb`.
 */
const ACCENT_RGB = '34, 197, 94';

/**
 * The bomb: a canvas-drawn fuse and casing that redraws every animation frame.
 *
 * Canvas rather than CSS because the fuse is a curve with a travelling spark
 * and a particle trail — expressible in CSS only as a stack of hacks, and
 * cheaper here as a single 60fps draw call into one element.
 *
 * Everything is parameterised by `progress` (0 at turn start, 1 at detonation),
 * so the visual, the shake and the audio all read from the same number.
 */

interface BombProps {
  /** Linear fuse progress, 0..1. Drives heat and the countdown readout. */
  readonly progress: number;
  /** Eased fuse position from the engine. Reaches 1.0 with `progress`. */
  readonly visualProgress: number;
  /** 0..1 urgency past the acceleration threshold. */
  readonly intensity: number;
  readonly remainingMs: number;
  readonly syllable: string;
  readonly exploding: boolean;
  readonly reducedMotion: boolean;
  /** Rendered edge in CSS pixels. The drawing is authored at 320 and scaled. */
  readonly size?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

export const Bomb = ({
  progress,
  visualProgress,
  intensity,
  remainingMs,
  syllable,
  exploding,
  reducedMotion,
  size = 320,
}: BombProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const visualProgressRef = useRef(visualProgress);
  const intensityRef = useRef(intensity);
  const explodingRef = useRef(exploding);

  // Written every render and read inside the animation loop, so the draw call
  // sees current values without the effect resubscribing sixty times a second.
  progressRef.current = progress;
  visualProgressRef.current = visualProgress;
  intensityRef.current = intensity;
  explodingRef.current = exploding;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    // Draw at device resolution so the fuse spark is not a soft blob on HiDPI.
    //
    // The artwork is authored in a fixed 320-unit space and the context is
    // scaled to whatever the stage asked for. That keeps every constant in the
    // draw call — fuse length, casing radius, neck offsets — as a single
    // readable design, instead of sixteen multiplications that have to stay in
    // step with each other.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const DESIGN = 320;
    const scale = size / DESIGN;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    context.scale(dpr * scale, dpr * scale);

    const draw = (): void => {
      // `p` is real elapsed fraction — heat, glow and colour read from it.
      // `vp` is where the fuse is *drawn*; it runs on the eased curve.
      // `heat` is the acceleration term, zero until the threshold.
      const p = Math.min(1, Math.max(0, progressRef.current));
      const vp = Math.min(1, Math.max(0, visualProgressRef.current));
      const heat = Math.min(1, Math.max(0, intensityRef.current));
      context.clearRect(0, 0, DESIGN, DESIGN);

      const cx = DESIGN / 2;
      const cy = DESIGN / 2 + 26;
      const radius = 74;

      // Casing, with a heat glow that intensifies as the fuse burns down.
      const glow = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.9);
      glow.addColorStop(0, `rgba(${ACCENT_RGB}, ${Math.min(0.92, 0.18 + p * 0.5 + heat * 0.24)})`);
      glow.addColorStop(1, `rgba(${ACCENT_RGB}, 0)`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
      context.fill();

      const body = context.createRadialGradient(
        cx - radius * 0.35,
        cy - radius * 0.4,
        radius * 0.1,
        cx,
        cy,
        radius,
      );
      body.addColorStop(0, '#3a3f5c');
      body.addColorStop(0.55, '#171a2b');
      body.addColorStop(1, '#0a0b13');
      context.fillStyle = body;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = `rgba(255, 159, 74, ${0.25 + p * 0.55})`;
      context.lineWidth = 2;
      context.stroke();

      // Neck.
      context.fillStyle = '#22263c';
      context.fillRect(cx - 13, cy - radius - 16, 26, 20);

      // Fuse: a quadratic curve that shortens as it burns.
      const fuseStart = { x: cx, y: cy - radius - 16 };
      const fullLength = 92;
      const remaining = fullLength * (1 - vp);
      const tip = {
        x: fuseStart.x + Math.sin(vp * 5) * 16 + 22 * (1 - vp),
        y: fuseStart.y - remaining,
      };

      context.beginPath();
      context.moveTo(fuseStart.x, fuseStart.y);
      context.quadraticCurveTo(fuseStart.x + 30 * (1 - vp), fuseStart.y - remaining * 0.6, tip.x, tip.y);
      context.strokeStyle = '#6b5136';
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.stroke();

      // Spark at the tip, plus particles.
      if (remaining > 2) {
        const flickerMs = 60 - heat * 38;
        const sparkRadius = 6 + Math.sin(Date.now() / flickerMs) * 2 + p * 4 + heat * 3;
        const spark = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, sparkRadius * 2.6);
        spark.addColorStop(0, '#fff7e6');
        spark.addColorStop(0.35, '#ffb703');
        spark.addColorStop(1, `rgba(${ACCENT_RGB}, 0)`);
        context.fillStyle = spark;
        context.beginPath();
        context.arc(tip.x, tip.y, sparkRadius * 2.6, 0, Math.PI * 2);
        context.fill();

        if (!reducedMotion) {
          const emit = 1 + Math.floor(p * 3) + Math.floor(heat * 4);
          const spread = 1 + heat * 0.8;
          for (let i = 0; i < emit; i += 1) {
            particles.current.push({
              x: tip.x,
              y: tip.y,
              vx: (Math.random() - 0.5) * 1.6 * spread,
              vy: (-Math.random() * 1.6 - 0.4) * spread,
              life: 1,
              hue: 28 + Math.random() * 24,
            });
          }
        }
      }

      if (explodingRef.current && particles.current.length < 260 && !reducedMotion) {
        for (let i = 0; i < 26; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2 + Math.random() * 6;
          particles.current.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            hue: 18 + Math.random() * 40,
          });
        }
      }

      const survivors: Particle[] = [];
      for (const particle of particles.current) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.06;
        particle.life -= 0.024;
        if (particle.life <= 0) continue;
        context.fillStyle = `hsla(${particle.hue}, 100%, ${55 + particle.life * 25}%, ${particle.life})`;
        context.fillRect(particle.x, particle.y, 2.4, 2.4);
        survivors.push(particle);
      }
      particles.current = survivors.slice(-320);

      frame.current = requestAnimationFrame(draw);
    };

    frame.current = requestAnimationFrame(draw);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [reducedMotion, size]);

  const seconds = (remainingMs / 1000).toFixed(1);

  return (
    <div className="relative flex flex-col items-center">
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-10">
        <div
          className="syllable font-display font-bold uppercase leading-none"
          style={{ color: 'var(--bp-text)', fontSize: `${Math.round(size * 0.19)}px` }}
        >
          {syllable}
        </div>
        <div
          className="mt-2 font-mono text-sm tabular-nums"
          style={{ color: progress > 0.75 ? 'var(--bp-bad)' : 'var(--bp-muted)' }}
        >
          {seconds}s
        </div>
      </div>
    </div>
  );
};
