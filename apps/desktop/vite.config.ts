import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The renderer is a plain web build. It has no Node integration and no access
 * to the filesystem — everything it needs arrives over the preload bridge — so
 * nothing here needs to know it is running inside Electron.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'chrome120',
  },
  server: { port: 5173, strictPort: true },
});
