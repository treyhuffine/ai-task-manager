import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the emitted ESM with plain Node. tsx and Next's loader accept imports
// that the portable runtime cannot resolve, so source-only smoke tests miss them.
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-cli-boot-'));
const env = { ...process.env, RI_ROOT: root, PORT: '9' };
for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_BRAIN_PATH',
  'RI_SESSION_CREDENTIAL', 'RI_SESSION_CLI', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete env[name];

try {
  for (const args of [['--help'], ['start', '--help']]) {
    const output = execFileSync(process.execPath, [path.join(repo, 'dist/cli/index.mjs'), ...args], {
      cwd: repo, env, encoding: 'utf8', timeout: 30_000,
    });
    assert.match(output, /Usage: ri/);
  }
  assert.deepEqual(fs.readdirSync(root), [], 'CLI help must not initialize a Home');
  console.info('Compiled CLI boot graph resolves under plain Node.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
