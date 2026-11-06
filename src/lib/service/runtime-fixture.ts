/** Test-only: a small but complete runtime (every file a manifest requires),
 * with an optional `node/bin/node` script standing in for the real binary. */
import fs from 'node:fs';
import path from 'node:path';
import { createRuntimeManifest } from './runtime-manifest';

export const REQUIRED_RUNTIME_FILES = ['node/bin/node', 'server/dist/service/main.cjs', 'server/dist/service/http-server.cjs', 'server/dist/service/handoff.cjs', 'server/dist/service/runtime-job.cjs', 'server/dist/cli/index.mjs'];

export interface FixtureOptions {
  version?: string;
  /** Shell run as the release's `node`. It is executable. */
  node?: string;
  files?: Record<string, string>;
}

export function writeRuntimeFixture(directory: string, options: FixtureOptions = {}) {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const file of REQUIRED_RUNTIME_FILES) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), file);
  }
  fs.writeFileSync(path.join(directory, 'server/package.json'), JSON.stringify({ version: options.version ?? '0.1.0' }));
  if (options.node !== undefined) fs.writeFileSync(path.join(directory, 'node/bin/node'), `#!/bin/sh\n${options.node}\n`);
  fs.chmodSync(path.join(directory, 'node/bin/node'), 0o755);
  for (const [name, content] of Object.entries(options.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), content);
  }
  return createRuntimeManifest(directory);
}
