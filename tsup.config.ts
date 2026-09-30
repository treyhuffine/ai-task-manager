import { defineConfig } from 'tsup';

export default defineConfig([{
  entry: ['src/cli/index.ts'],
  outDir: 'dist/cli',
  format: ['esm'],
  target: 'node20',
  clean: true,
  splitting: false,
  // Workspace packages export TypeScript source. Bundle them into the
  // published CLI so Node never has to resolve extensionless TS imports.
  noExternal: [/^@connectors\/engine(?:\/.*)?$/],
  // Source file's `#!/usr/bin/env node` is preserved automatically.
  // Resolve `@/*` aliases the same way tsconfig does.
  tsconfig: 'tsconfig.json',
}, {
  entry: ['src/service/main.ts', 'src/service/worker.ts', 'src/service/watchdog.ts', 'src/service/http-server.ts', 'src/service/handoff.ts', 'src/service/runtime-job.ts'],
  outDir: 'dist/service', format: ['cjs'], target: 'node22',
  outExtension: () => ({ js: '.cjs' }), clean: true, splitting: false, shims: true,
  noExternal: [/^@connectors\/engine(?:\/.*)?$/], tsconfig: 'tsconfig.json',
}]);
