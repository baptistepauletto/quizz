import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    host: true, // reachable from phones on the LAN in dev
    port: 5173,
    proxy: {
      '/api': `http://localhost:${SERVER_PORT}`,
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
