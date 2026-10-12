import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  server: {
    port: 5173,
    // En dev, l'API (wrangler dev) est servie sur le même origine : pas de CORS à gérer.
    proxy: { '/api': 'http://localhost:8787' },
    fs: { allow: ['..'] },
  },
  preview: { port: 4173 },
});
