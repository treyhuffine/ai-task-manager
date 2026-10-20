import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the emitted ESM with plain Node. tsx and Next's loader accept imports
// that the portable runtime cannot resolve, so source-only smoke tests miss them.
const repo = fileURLToPath(new URL('../', import.meta.url));

// Running from the checkout can't prove the bundles leave no TypeScript to load:
// workspace packages resolve to packages/, where Node strips types, but the
// desktop package installs them under node_modules, where it refuses to.
const BARE_IMPORT = /\bfrom\s*["']([^"'./][^"']*)["']|\b(?:import|require)\s*\(\s*["']([^"'./][^"']*)["']\s*\)/g;
const bundles = ['dist/cli/index.mjs', ...fs.readdirSync(path.join(repo, 'dist/service'))
  .filter(name => name.endsWith('.cjs')).map(name => `dist/service/${name}`)];
for (const bundle of bundles) {
  const file = path.join(repo, bundle);
  const resolve = createRequire(file).resolve;
  const specifiers = new Set(Array.from(fs.readFileSync(file, 'utf8').matchAll(BARE_IMPORT), m => m[1] ?? m[2]));
  for (const specifier of specifiers) {
    let target;
    try { target = resolve(specifier); } catch { continue; }
    assert.doesNotMatch(target, /\.[cm]?tsx?$/,
      `${bundle} loads TypeScript source from ${specifier}. Add it to noExternal in tsup.config.ts.`);
  }
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-cli-boot-'));
const env = { ...process.env, RI_ROOT: root, PORT: '9' };
for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR', 'RI_BRAIN_PATH',
  'RI_SESSION_CREDENTIAL', 'RI_SESSION_CLI', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) delete env[name];

try {
  for (const args of [['--help'], ['start', '--help'], ['team', 'create', '--help']]) {
    const output = execFileSync(process.execPath, [path.join(repo, 'dist/cli/index.mjs'), ...args], {
      cwd: repo, env, encoding: 'utf8', timeout: 30_000,
    });
    assert.match(output, /Usage: ri/);
    if (args[0] === 'team') {
      assert.doesNotMatch(output, /--name/);
      assert.match(output, /Name your team.*browser/);
    }
  }
  assert.deepEqual(fs.readdirSync(root), [], 'CLI help must not initialize a Home');
  const teamRoot = path.join(root, 'team root');
  execFileSync(process.execPath, [path.join(repo, 'dist/cli/index.mjs'), 'team', 'create', '--root', teamRoot,
    '--no-start'], { cwd: repo, env, encoding: 'utf8', timeout: 30_000 });
  assert.deepEqual(fs.readdirSync(root), ['team root'], 'explicit team target must be selected before CLI activity writes');
  assert.equal(JSON.parse(fs.readFileSync(path.join(teamRoot, '.config/team.json'), 'utf8')).kind, 'team');
  assert(!fs.existsSync(path.join(teamRoot, 'data.db')), 'provision-only creation must not open a database or service');
  console.info('Compiled CLI boot graph resolves under plain Node.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
