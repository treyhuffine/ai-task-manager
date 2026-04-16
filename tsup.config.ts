import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  outDir: 'dist/cli',
  format: ['esm'],
  target: 'node20',
  clean: true,
  // Source file's `#!/usr/bin/env node` is preserved automatically.
  // Resolve `@/*` aliases the same way tsconfig does.
  tsconfig: 'tsconfig.json',
});
