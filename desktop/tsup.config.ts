import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['desktop/main.ts', 'desktop/backend.ts', 'desktop/preload.ts', 'desktop/local-preload.ts', 'desktop/maintenance-preload.ts', 'desktop/inspect-installation.ts', 'desktop/connection-setup-entry.ts', 'desktop/companion-preload.ts'],
  outDir: 'dist/desktop',
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node22',
  clean: true,
  splitting: false,
  shims: true,
  external: ['electron'],
  noExternal: [/^@integrations\/engine(?:\/.*)?$/, 'electron-updater', 'zod'],
  tsconfig: 'tsconfig.json',
});
