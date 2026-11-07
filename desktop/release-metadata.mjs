/** What one platform's build contributes to a release: its artifacts' checksums,
 * and what it can talk to. Runs on the build machine, with no signing key. Signing
 * happens once, for every platform, in desktop/publish-release.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { reviewedRuntime, verifyRuntimeArtifact, verifyShellArtifact } from './release-artifacts.mjs';
import { appPartId } from './package-files.mjs';

const { values: v } = parseArgs({ options: {
  resources: { type: 'string' }, runtime: { type: 'string' }, shell: { type: 'string' },
  'base-url': { type: 'string' }, out: { type: 'string' },
} });
for (const key of ['resources', 'runtime', 'base-url', 'out']) if (!v[key]) throw new Error(`Missing --${key}`);
const base = new URL(v['base-url'].endsWith('/') ? v['base-url'] : `${v['base-url']}/`);
if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Artifact URLs must use HTTPS');
const reviewed = reviewedRuntime(v.resources);
const { manifest } = reviewed;
if (fs.existsSync(path.join(v.resources, 'server/speech-helper')) || manifest.files?.some(file => file.name?.startsWith('server/speech-helper/'))) {
  throw new Error('This build carries the speech helper, which has its own publisher review. Sign it with desktop/sign-release.mjs.');
}
const migrationHistory = reviewed.expected.get('server/drizzle/meta/_journal.json')?.sha256;
if (!migrationHistory) throw new Error('Reviewed runtime is missing its migration journal');
// Asked of the build itself, on the machine that built it: what it can talk to.
const compatibility = JSON.parse(execFileSync(path.join(v.resources, 'node/bin/node'), [path.join(v.resources, 'server/dist/cli/index.mjs'), 'service', 'compatibility'], { encoding: 'utf8', env: { ...process.env, RI_RUNTIME_REPO: path.join(v.resources, 'server') } }));
const payload = {
  version: manifest.version, platform: manifest.platform, arch: manifest.arch,
  minimumUpdater: 1, apiProtocol: 1, configFormat: 1, migrationHistory,
  runtime: { id: manifest.id, url: new URL(path.basename(v.runtime), base).href, ...await verifyRuntimeArtifact(v.runtime, reviewed), unpackedSize: reviewed.total },
  // Runs where the build ran, so dist/desktop is what this artifact was packaged from.
  ...(v.shell ? { shell: { url: new URL(path.basename(v.shell), base).href, ...await verifyShellArtifact(v.shell, reviewed), id: appPartId('dist/desktop', JSON.parse(fs.readFileSync('package.json', 'utf8')).devDependencies.electron) } } : {}),
  compatibility,
};
fs.mkdirSync(v.out, { recursive: true });
fs.writeFileSync(path.join(v.out, `${manifest.platform}-${manifest.arch}.payload.json`), `${JSON.stringify(payload, null, 2)}\n`);
console.info(`Release metadata for ${manifest.version} on ${manifest.platform}-${manifest.arch}`);
