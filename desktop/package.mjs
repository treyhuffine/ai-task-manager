import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createPublicKey } from 'node:crypto';
import { assertDesktopPackagingRuntime, DESKTOP_NODE_VERSION } from './package-preflight.mjs';

assertDesktopPackagingRuntime();
const { build, Platform, Arch } = await import('electron-builder');
const tar = await import('tar');
const { assertCompanionPackage, assertShellDependencies, rebaseResourceLinks } = await import('./package-files.mjs');
const { signRuntime } = await import('./sign-runtime.mjs');
const { stageSpeechHelper } = await import('./speech/package.mjs');

const repo = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const headless = process.argv.includes('--headless');
const releaseBuild = process.argv.includes('--release');
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
const deployed = path.join(stage, 'deployed');
run('pnpm', ['--filter', 'ai-task-manager', 'deploy', '--prod', '--legacy', '--ignore-scripts', deployed]);
// Workspace packages may be hardlinked to the checkout. Freeze their bytes so
// editing source while packaging cannot change a manifest that was just made.
fs.cpSync(deployed, server, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
rebaseResourceLinks(server, deployed);
fs.rmSync(deployed, { recursive: true, force: true });
for (const name of ['public', 'drizzle', 'skills', 'dist']) fs.cpSync(path.join(repo, name), path.join(server, name), { recursive: true });
if (process.argv.includes('--with-speech')) stageSpeechHelper(path.join(repo, 'release/speech-helper'), path.join(server, 'speech-helper'));
fs.cpSync(path.join(repo, '.next-desktop'), path.join(server, '.next-desktop'), {
  recursive: true,
  // Turbopack's hashed externals link into ../node_modules. Keep those relative.
  verbatimSymlinks: true,
  filter: (source) => !source.endsWith('.nft.json') && !['cache', 'dev', 'types', 'diagnostics', 'trace', 'trace-build'].includes(path.basename(source)),
});
// Next's TS config loader requires dev-only TypeScript. Ship equivalent JavaScript.
const { transformSync } = createRequire(require.resolve('tsup'))('esbuild');
fs.writeFileSync(path.join(server, 'next.config.mjs'), transformSync(fs.readFileSync(path.join(repo, 'next.config.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code);

const version = DESKTOP_NODE_VERSION;
const archive = `node-v${version}-${process.platform}-${process.arch}.tar.gz`;
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
for (const name of ['main.cjs', 'preload.cjs', 'maintenance-preload.cjs', 'companion-preload.cjs', 'local-preload.cjs']) fs.copyFileSync(path.join(repo, 'dist/desktop', name), path.join(shell, name));
assertCompanionPackage(server, shell);
assertShellDependencies(shell);
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ name: 'ri-desktop', productName: 'Ri', desktopName: 'app.ri.desktop.desktop', version: pkg.version, main: 'main.cjs', description: pkg.description ?? 'Ri desktop', author: 'Ri contributors', dependencies: {} }));
const desktopConfig = path.join(stage, 'desktop-config.json');
const callbackUrl = process.env.RI_DESKTOP_OAUTH_RELAY_URL;
if (callbackUrl) {
  const url = new URL(callbackUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Callback service must be a plain HTTPS URL');
}
fs.writeFileSync(desktopConfig, JSON.stringify({ callbackUrl, relayProviders: process.env.RI_DESKTOP_OAUTH_RELAY_PROVIDERS }));
// Finalize resources before signing. Neither an updater nor a running service
// may modify a signed .app after this step.
console.info(`Verified ${rebaseResourceLinks(stage, stage)} portable resource links.`);
if (releaseBuild && process.platform === 'darwin') {
  if (!process.env.CSC_NAME) throw new Error('Signed macOS releases require CSC_NAME with your Developer ID Application identity');
  signRuntime(stage, process.env.CSC_NAME, path.join(repo, 'desktop/runtime-entitlements.plist'));
  if (process.argv.includes('--with-speech')) {
    // Signing changes native bytes. Inventory the final signed helper before
    // freezing the runtime so publisher review can bind to this candidate.
    run(process.env.RI_SPEECH_BUILD_PYTHON || path.join(repo, '.electron-demo/speech-build/venv/bin/python'),
      [path.join(repo, 'desktop/speech/native_inventory.py'), path.join(server, 'speech-helper')]);
    run(process.env.RI_SPEECH_BUILD_PYTHON || path.join(repo, '.electron-demo/speech-build/venv/bin/python'),
      [path.join(repo, 'desktop/speech/native_inventory.py'), path.join(server, 'speech-helper'), '--verify']);
  }
}
run(process.execPath, ['dist/cli/index.mjs', 'service', 'manifest', stage]);
const policy = path.join(stage, 'release-policy.json');
if (process.env.RI_RELEASE_FEED || process.env.RI_RELEASE_PUBLIC_KEY_FILE) {
  if (!process.env.RI_RELEASE_FEED || !process.env.RI_RELEASE_PUBLIC_KEY_FILE) throw new Error('Configure both RI_RELEASE_FEED and RI_RELEASE_PUBLIC_KEY_FILE');
  const feed = new URL(process.env.RI_RELEASE_FEED);
  if (feed.protocol !== 'https:' || feed.username || feed.password) throw new Error('Release feed must use HTTPS');
  const publicKey = fs.readFileSync(process.env.RI_RELEASE_PUBLIC_KEY_FILE, 'utf8');
  if (!publicKey.startsWith('-----BEGIN PUBLIC KEY-----') || createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Supply an Ed25519 PUBLIC key, never the signing private key');
  fs.writeFileSync(policy, JSON.stringify({ format: 1, feed: feed.href, publicKey, channel: process.env.RI_RELEASE_CHANNEL ?? 'stable', automaticDownload: true, metered: false }));
}
if (releaseBuild && !fs.existsSync(policy)) throw new Error('Release builds require a publisher public key and HTTPS feed');
const runtimeName = `ri-runtime-${pkg.version}-${process.platform}-${process.arch}`;
const runtimeOutput = path.join(repo, 'release', runtimeName);
// This output is generated by this command. Do not merge a previous build's
// dependency graph or publisher policy into the new artifact.
fs.rmSync(runtimeOutput, { recursive: true, force: true });
fs.mkdirSync(runtimeOutput, { recursive: true });
for (const name of ['node', 'server', 'runtime-manifest.json', ...(fs.existsSync(policy) ? ['release-policy.json'] : [])]) {
  fs.cpSync(path.join(stage, name), path.join(runtimeOutput, name), { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
}
const runtimeArchive = `${runtimeOutput}.tar.gz`;
await tar.c({ file: runtimeArchive, cwd: runtimeOutput, gzip: true, portable: true, noMtime: true }, ['node', 'server', 'runtime-manifest.json', ...(fs.existsSync(policy) ? ['release-policy.json'] : [])]);
console.info(`Headless runtime: ${runtimeOutput}`);
console.info(`Update payload: ${runtimeArchive}`);
if (!headless) {
  const platform = process.platform === 'darwin' ? Platform.MAC : Platform.LINUX;
  const targets = releaseBuild ? (process.platform === 'darwin' ? ['dmg', 'zip'] : ['AppImage']) : ['dir'];
  const resourcesToCopy = ['server', 'node', 'desktop-config.json', 'runtime-manifest.json', ...(fs.existsSync(policy) ? ['release-policy.json'] : [])];
  const output = await build({ targets: platform.createTarget(targets, process.arch === 'arm64' ? Arch.arm64 : Arch.x64), publish: 'never', config: {
    appId: 'app.ri.desktop', productName: 'Ri', electronVersion: pkg.devDependencies.electron,
    directories: { app: shell, output: path.join(repo, 'release/desktop'), buildResources: path.join(repo, 'assets/brand/icons') },
    files: ['main.cjs', 'preload.cjs', 'maintenance-preload.cjs', 'companion-preload.cjs', 'local-preload.cjs', 'package.json', '!node_modules/**/*'], asar: true,
    npmRebuild: false, nodeGypRebuild: false, forceCodeSigning: releaseBuild && process.platform === 'darwin',
    protocols: [{ name: 'Ri OAuth callback', schemes: ['ri'] }],
    mac: { icon: path.join(repo, 'assets/brand/icons/icon.icns'), identity: releaseBuild ? process.env.CSC_NAME : null, signIgnore: ['Contents/Resources/server/', 'Contents/Resources/node/'], hardenedRuntime: true, notarize: releaseBuild,
      extendInfo: { NSMicrophoneUsageDescription: 'Ri uses the microphone when you record a voice message.', NSCameraUsageDescription: 'Ri uses the camera when you scan a pairing code.' } },
    linux: { executableName: 'ri', syncDesktopName: true, icon: path.join(repo, 'assets/brand/icons'), category: 'Office' },
    // The native updater obtains the eligible URL from signed Ri metadata.
    publish: process.env.RI_RELEASE_FEED ? [{ provider: 'generic', url: new URL('.', process.env.RI_RELEASE_FEED).href }] : null,
    afterPack: async context => {
      const resources = process.platform === 'darwin' ? path.join(context.appOutDir, 'Ri.app/Contents/Resources') : path.join(context.appOutDir, 'resources');
      // Builder's dependency filters prune pnpm's virtual store even for
      // extraResources. Copy the already verified runtime verbatim instead.
      for (const name of resourcesToCopy) fs.cpSync(path.join(stage, name), path.join(resources, name), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      rebaseResourceLinks(resources, stage);
      // Any changed bytes here are included in the subsequent OS signature.
      run(process.execPath, ['dist/cli/index.mjs', 'service', 'manifest', resources]);
    },
    afterSign: async context => {
      if (process.platform !== 'darwin') return;
      const resources = path.join(context.appOutDir, 'Ri.app/Contents/Resources');
      run(process.execPath, ['dist/cli/index.mjs', 'service', 'verify', resources]);
    },
  } });
  console.info(`Desktop output: ${output.join(', ') || path.join(repo, 'release/desktop')}`);
}
console.info(releaseBuild ? 'Artifacts built. Verify them and sign the release manifest before publishing.' : 'Local unsigned build. This is not a published release.');
fs.rmSync(stage, { recursive: true, force: true });
