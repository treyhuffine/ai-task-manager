import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';
import { rebaseResourceLinks } from './package-files.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This package target currently supports macOS arm64.');
const run = (cmd, args, cwd = repo, env = process.env) => {
  const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited with ${result.status}`);
};
const artifacts = path.join(repo, '.electron-demo');
fs.mkdirSync(artifacts, { recursive: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-package-stage-'));
const server = path.join(stage, 'server');
const shell = path.join(stage, 'shell');
const node = path.join(stage, 'node');
run('pnpm', ['desktop:build']);
if (!process.argv.includes('--skip-build')) run(process.execPath, ['desktop/launch.mjs', '--build-only']);
if (!fs.existsSync(path.join(repo, '.next-desktop/BUILD_ID'))) throw new Error('Build the production app first.');

// pnpm deploy copies the package allowlist and a self-contained production graph.
// Explicitly copy Next runtime assets afterwards. Never copy .env or a data home.
run('pnpm', ['--filter', 'ai-task-manager', 'deploy', '--prod', '--legacy', '--ignore-scripts', server]);
for (const name of ['public', 'drizzle', 'skills', 'dist']) fs.cpSync(path.join(repo, name), path.join(server, name), { recursive: true });
fs.cpSync(path.join(repo, '.next-desktop'), path.join(server, '.next-desktop'), {
  recursive: true,
  // Turbopack's hashed externals link into ../node_modules. Keep those relative.
  verbatimSymlinks: true,
  filter: (source) => !source.endsWith('.nft.json') && !['cache', 'dev', 'types', 'diagnostics', 'trace', 'trace-build'].includes(path.basename(source)),
});
// Next's TS config loader requires dev-only TypeScript. Ship equivalent JavaScript.
const { transformSync } = createRequire(require.resolve('tsup'))('esbuild');
fs.writeFileSync(path.join(server, 'next.config.mjs'), transformSync(fs.readFileSync(path.join(repo, 'next.config.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code);

const version = process.versions.node;
const archive = `node-v${version}-darwin-arm64.tar.gz`;
const base = `https://nodejs.org/dist/v${version}/`;
const checksums = await fetch(`${base}SHASUMS256.txt`).then((r) => { if (!r.ok) throw new Error('Could not download Node checksums'); return r.text(); });
const expected = checksums.split('\n').map((line) => line.trim().split(/\s+/)).find(([, name]) => name === archive)?.[0];
if (!expected) throw new Error('Official Node checksum not found');
const cache = path.join(artifacts, archive);
if (!fs.existsSync(cache)) {
  const response = await fetch(`${base}${archive}`);
  if (!response.ok) throw new Error('Could not download portable Node');
  fs.writeFileSync(cache, Buffer.from(await response.arrayBuffer()));
}
if (createHash('sha256').update(fs.readFileSync(cache)).digest('hex') !== expected) throw new Error('Node download checksum mismatch');
fs.mkdirSync(node);
run('/usr/bin/tar', ['-xzf', cache, '--strip-components=1', '-C', node]);

// Scripts were disabled in deploy, so preserve the already-built native artifacts
// from this exact Node ABI. Do not rebuild these libraries for Electron.
const deployedRequire = createRequire(path.join(server, 'package.json'));
for (const name of ['better-sqlite3', 'node-pty']) {
  const source = path.dirname(require.resolve(`${name}/package.json`));
  const target = path.dirname(deployedRequire.resolve(`${name}/package.json`));
  for (const folder of ['build/Release', 'prebuilds']) if (fs.existsSync(path.join(source, folder))) {
    fs.cpSync(path.join(source, folder), path.join(target, folder), { recursive: true });
  }
}
const portableNode = path.join(node, 'bin/node');
run(portableNode, ['-e', "const db = new (require('better-sqlite3'))(':memory:'); require('sqlite-vec').load(db); console.log('SQLite/vector:', db.prepare('select vec_version() version').get()); db.close(); require('node-pty').spawn('/bin/echo', ['PTY ready']).onExit(({exitCode}) => {if (exitCode) process.exitCode=exitCode;});"], server);
run(portableNode, ['dist/cli/index.mjs', '--help'], server);

fs.mkdirSync(shell);
for (const name of ['main.cjs', 'preload.cjs']) fs.copyFileSync(path.join(repo, 'dist/desktop', name), path.join(shell, name));
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ name: 'ri-desktop', productName: 'Ri', version: pkg.version, main: 'main.cjs' }));
const desktopConfig = path.join(stage, 'desktop-config.json');
const callbackUrl = process.env.RI_DESKTOP_OAUTH_RELAY_URL;
if (callbackUrl) {
  const url = new URL(callbackUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Callback service must be a plain HTTPS URL');
}
fs.writeFileSync(desktopConfig, JSON.stringify({ callbackUrl, relayProviders: process.env.RI_DESKTOP_OAUTH_RELAY_PROVIDERS }));
const output = await packager({
  dir: shell, out: path.join(repo, 'release'), name: 'Ri', platform: 'darwin', arch: 'arm64',
  electronVersion: pkg.devDependencies.electron, appBundleId: 'app.ri.desktop', appVersion: pkg.version,
  asar: true, prune: false, overwrite: true, extraResource: [server, node, desktopConfig],
  icon: path.join(repo, 'assets/brand/icons/icon.icns'), protocols: [{ name: 'Ri OAuth callback', schemes: ['ri'] }],
  extendInfo: { NSMicrophoneUsageDescription: 'Ri uses the microphone when you record a voice message.' },
});
const resources = path.join(output[0], 'Ri.app/Contents/Resources');
console.info(`Verified ${rebaseResourceLinks(resources, stage)} portable resource links.`);
console.info(`Packaged app: ${path.join(output[0], 'Ri.app')}`);
console.info('This local build is unsigned. Public distribution requires signing and notarization.');
fs.rmSync(stage, { recursive: true, force: true });
