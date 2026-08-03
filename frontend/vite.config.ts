import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[hash].js',
        entryFileNames: 'assets/[hash].js',
      },
    },
  },
  server: {
    /** Accesible desde el celular en la misma Wi‑Fi (http://TU_IP:5173). */
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
      '/assets': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
});
