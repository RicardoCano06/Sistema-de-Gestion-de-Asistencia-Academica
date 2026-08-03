import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@frontend': path.resolve(process.cwd(), 'frontend/src')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**']
  }
});
