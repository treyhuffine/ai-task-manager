import { defineConfig } from 'tsup';

// Workspace packages export TypeScript source. Bundle them into the published
// CLI and service: Node strips types only outside node_modules, and the desktop
// package installs them there (scripts/smoke-cli-boot.mjs checks the output).
const workspaceSource = [/^@integrations\/engine(?:\/.*)?$/, /^@ri\/mcp-apps-host(?:\/.*)?$/];

export default defineConfig([{
  entry: ['src/cli/index.ts'],
  outDir: 'dist/cli',
  format: ['esm'],
  target: 'node20',
  clean: true,
  splitting: false,
  noExternal: workspaceSource,
  // Source file's `#!/usr/bin/env node` is preserved automatically.
  // Resolve `@/*` aliases the same way tsconfig does.
  tsconfig: 'tsconfig.json',
}, {
  entry: ['src/service/main.ts', 'src/service/worker.ts', 'src/service/watchdog.ts', 'src/service/http-server.ts', 'src/service/handoff.ts', 'src/service/runtime-job.ts'],
  outDir: 'dist/service', format: ['cjs'], target: 'node22',
  outExtension: () => ({ js: '.cjs' }), clean: true, splitting: false, shims: true,
  noExternal: workspaceSource, tsconfig: 'tsconfig.json',
}]);
