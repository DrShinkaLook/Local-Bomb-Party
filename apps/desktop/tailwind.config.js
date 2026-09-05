/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Original palette. Deep indigo ground, green accents over a warm fuse.
        ground: { 950: '#07070d', 900: '#0c0d18', 850: '#12142280', 800: '#161829' },
        ember: { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a' },
        fuse: { 400: '#ffd166', 500: '#ffb703' },
        mint: { 400: '#5eead4', 500: '#2dd4bf' },
        danger: { 400: '#ff6b6b', 500: '#f03e3e' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)' },
          '25%': { transform: 'translate(var(--shake), calc(var(--shake) * -0.6)) rotate(-0.4deg)' },
          '50%': { transform: 'translate(calc(var(--shake) * -1), var(--shake)) rotate(0.4deg)' },
          '75%': { transform: 'translate(calc(var(--shake) * 0.6), var(--shake)) rotate(-0.2deg)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(1)', opacity: '0.65' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        riseFade: {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-42px) scale(1.25)', opacity: '0' },
        },
      },
      animation: {
        shake: 'shake 220ms ease-in-out infinite',
        pulseRing: 'pulseRing 1.1s ease-out infinite',
        riseFade: 'riseFade 900ms ease-out forwards',
      },
    },
  },
  plugins: [],
};
