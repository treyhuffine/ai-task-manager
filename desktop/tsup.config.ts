import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['desktop/main.ts', 'desktop/backend.ts', 'desktop/preload.ts'],
  outDir: 'dist/desktop',
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node22',
  clean: true,
  splitting: false,
  shims: true,
  external: ['electron'],
  noExternal: [/^@connectors\/engine(?:\/.*)?$/],
  tsconfig: 'tsconfig.json',
});
