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
  readonly progress: number;
  readonly remainingMs: number;
  readonly syllable: string;
  readonly exploding: boolean;
  readonly reducedMotion: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

export const Bomb = ({ progress, remainingMs, syllable, exploding, reducedMotion }: BombProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const frame = useRef<number | null>(null);
  const progressRef = useRef(progress);
  const explodingRef = useRef(exploding);

  progressRef.current = progress;
  explodingRef.current = exploding;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    // Draw at device resolution so the fuse spark is not a soft blob on HiDPI.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 320;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    context.scale(dpr, dpr);

    const draw = (): void => {
      const p = Math.min(1, Math.max(0, progressRef.current));
      context.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2 + 26;
      const radius = 74;

      // Casing, with a heat glow that intensifies as the fuse burns down.
      const glow = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.9);
      glow.addColorStop(0, `rgba(${ACCENT_RGB}, ${0.18 + p * 0.5})`);
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
      const remaining = fullLength * (1 - p);
      const tip = {
        x: fuseStart.x + Math.sin(p * 5) * 16 + 22 * (1 - p),
        y: fuseStart.y - remaining,
      };

      context.beginPath();
      context.moveTo(fuseStart.x, fuseStart.y);
      context.quadraticCurveTo(fuseStart.x + 30 * (1 - p), fuseStart.y - remaining * 0.6, tip.x, tip.y);
      context.strokeStyle = '#6b5136';
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.stroke();

      // Spark at the tip, plus particles.
      if (remaining > 2) {
        const sparkRadius = 6 + Math.sin(Date.now() / 60) * 2 + p * 4;
        const spark = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, sparkRadius * 2.6);
        spark.addColorStop(0, '#fff7e6');
        spark.addColorStop(0.35, '#ffb703');
        spark.addColorStop(1, `rgba(${ACCENT_RGB}, 0)`);
        context.fillStyle = spark;
        context.beginPath();
        context.arc(tip.x, tip.y, sparkRadius * 2.6, 0, Math.PI * 2);
        context.fill();

        if (!reducedMotion) {
          const emit = 1 + Math.floor(p * 3);
          for (let i = 0; i < emit; i += 1) {
            particles.current.push({
              x: tip.x,
              y: tip.y,
              vx: (Math.random() - 0.5) * 1.6,
              vy: -Math.random() * 1.6 - 0.4,
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
  }, [reducedMotion]);

  const seconds = (remainingMs / 1000).toFixed(1);

  return (
    <div className="relative flex flex-col items-center">
      <canvas ref={canvasRef} width={320} height={320} className="h-[320px] w-[320px]" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-10">
        <div
          className="syllable font-display text-6xl font-bold uppercase"
          style={{ color: 'var(--bp-text)' }}
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
