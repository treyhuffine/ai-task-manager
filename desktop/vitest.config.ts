import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  test: { include: ['desktop/**/*.test.ts'], environment: 'node', setupFiles: ['src/test/setup-env.ts'] },
});
