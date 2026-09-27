import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Check the exact build inspected by native_inventory.py. Signing changes
 * native bytes, so re-inspect a signed final helper before distribution review. */
export function verifySpeechHelper(source) {
  source = fs.realpathSync.native(source);
  const inventory = JSON.parse(fs.readFileSync(path.join(source, 'native-inventory.json'), 'utf8'));
  if (inventory.format !== 1 || !Array.isArray(inventory.native) || !inventory.native.length || !Array.isArray(inventory.problems) || inventory.problems.length) throw new Error('Speech native inventory is incomplete or has unresolved dependencies.');
  const catalogHash = sha256(path.join(scripts, 'source-catalog.json'));
  if (inventory.sourceCatalogSha256 !== catalogHash || sha256(path.join(source, 'source-catalog.json')) !== catalogHash) throw new Error('Speech source catalog differs from the reviewed recipe.');
  const files = {};
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(source, file).split(path.sep).join('/');
      if (relative === 'native-inventory.json') continue;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        const resolved = path.relative(source, fs.realpathSync.native(file));
        if (path.isAbsolute(link) || resolved === '..' || resolved.startsWith(`..${path.sep}`) || path.isAbsolute(resolved)) throw new Error('Speech helper link escapes its installation.');
        files[relative] = { link };
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) files[relative] = { sha256: sha256(file), size: stat.size };
      else throw new Error('Unsupported speech helper filesystem entry.');
    }
  }
  walk(source);
  if (!isDeepStrictEqual(files, inventory.files)) throw new Error('Speech helper changed after native inspection. Rebuild or re-inspect it.');
  const notices = JSON.parse(fs.readFileSync(path.join(scripts, 'licenses/sources.json'), 'utf8'));
  for (const notice of notices.files) {
    const entry = files[`licenses/native/${notice.file}`];
    if (!entry || entry.sha256 !== notice.sha256) throw new Error(`Speech helper is missing the verified notice ${notice.file}.`);
  }
  return inventory;
}

/** Publisher-only gate. A Boolean environment flag is not an artifact-bound
 * review. No upload or publication occurs here. */
export function verifySpeechDistribution({ helper, bundle, approval, python }) {
  if (!bundle || !approval) throw new Error('Speech distribution requires verified source materials and an artifact-bound publisher review.');
  const executable = python || process.env.RI_SPEECH_BUILD_PYTHON || path.resolve(scripts, '../../.electron-demo/speech-build/venv/bin/python');
  const result = spawnSync(executable, [path.join(scripts, 'release_materials.py'), 'verify-release', '--helper', path.resolve(helper), '--bundle', path.resolve(bundle), '--approval', path.resolve(approval)], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024, env: { ...process.env, ORT_DISABLE_TELEMETRY: '1' } });
  if (result.error || result.status !== 0) throw new Error(`Speech distribution verification failed: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Run before signing and runtime inventory so helper bytes have the same
 * publisher trust and update boundary as the bundled ordinary Node. */
export function stageSpeechHelper(source, destination) {
  if (!fs.existsSync(path.join(source, 'build.json'))) throw new Error('Build the optional speech helper first with pnpm speech:build.');
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'build.json'), 'utf8'));
  if (metadata.protocol !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch) throw new Error('Speech helper must be built for this OS and architecture.');
  verifySpeechHelper(source);
  for (const file of ['ri-speech-helper', 'NOTICES.md', 'requirements.txt']) if (!fs.statSync(path.join(source, file)).isFile()) throw new Error(`Speech helper is missing ${file}.`);
  const result = spawnSync(path.join(source, 'ri-speech-helper'), ['--version'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4096 });
  if (result.error || result.status !== 0) throw new Error(`Speech helper native probe failed: ${result.error?.message ?? result.stderr}`);
  fs.cpSync(source, destination, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
  console.info(`Included optional managed speech helper (${metadata.platform}/${metadata.arch}). Models download only after opting in.`);
}
