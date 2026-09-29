/** Create authenticated release metadata. Does not upload or publish anything. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPrivateKey, sign } from 'node:crypto';
import { parseArgs } from 'node:util';
import { verifySpeechDistribution } from './speech/package.mjs';
import { reviewedRuntime, verifyRuntimeArtifact, verifyShellArtifact } from './release-artifacts.mjs';
const { values: v } = parseArgs({ options: {
  resources: { type: 'string' }, runtime: { type: 'string' }, 'runtime-url': { type: 'string' },
  shell: { type: 'string' }, 'shell-url': { type: 'string' }, sequence: { type: 'string' },
  'private-key': { type: 'string' }, out: { type: 'string' }, notes: { type: 'string' },
  channel: { type: 'string', default: 'stable' }, 'expires-days': { type: 'string', default: '7' },
  'speech-sources': { type: 'string' }, 'speech-review': { type: 'string' },
} });
for (const key of ['resources', 'runtime', 'runtime-url', 'sequence', 'private-key', 'out']) if (!v[key]) throw new Error(`Missing --${key}`);
const reviewed = reviewedRuntime(v.resources);
const { manifest } = reviewed;
const runtimeArtifact = await verifyRuntimeArtifact(v.runtime, reviewed);
if (!!v.shell !== !!v['shell-url']) throw new Error('Supply both --shell and --shell-url');
const shellArtifact = v.shell ? await verifyShellArtifact(v.shell, reviewed) : null;
const speechHelper = path.join(v.resources, 'server/speech-helper');
if (fs.existsSync(speechHelper) || manifest.files?.some(file => file.name?.startsWith('server/speech-helper/'))) {
  if (!v['speech-sources'] || !v['speech-review']) throw new Error('Speech distribution requires verified source materials and an artifact-bound publisher review.');
  // The review and journal must bind to the snapshot inspected above, even if
  // a concurrent build replaces --resources during a long archive scan.
  const reviewBytes = fs.readFileSync(v['speech-review']);
  if (JSON.parse(reviewBytes).helperInventorySha256 !== reviewed.expected.get('server/speech-helper/native-inventory.json')?.sha256) throw new Error('Speech publisher review does not match the helper inside these artifacts');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-publisher-review-'));
  try {
    const approval = path.join(temporary, 'review.json'); fs.writeFileSync(approval, reviewBytes, { flag: 'wx', mode: 0o600 });
    verifySpeechDistribution({ helper: speechHelper, bundle: v['speech-sources'], approval });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
const sequence = Number(v.sequence);
const days = Number(v['expires-days']);
if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isInteger(days) || days < 1 || days > 30) throw new Error('Sequence must increase monotonically. Metadata lifetime must be 1-30 days.');
if (!['stable', 'beta'].includes(v.channel)) throw new Error('Choose stable or beta channel');
function https(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Artifact URLs must use HTTPS'); return u.href; }
const migrationHistory = reviewed.expected.get('server/drizzle/meta/_journal.json')?.sha256;
if (!migrationHistory) throw new Error('Reviewed runtime is missing its migration journal');
const release = {
  format: 1, sequence, version: manifest.version, channel: v.channel,
  publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
  platform: manifest.platform, arch: manifest.arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1,
  withdrawn: false, notes: v.notes ? fs.readFileSync(v.notes, 'utf8') : '',
  migrationHistory,
  runtime: { id: manifest.id, url: https(v['runtime-url']), ...runtimeArtifact,
    unpackedSize: reviewed.total },
};
if (shellArtifact) {
  release.shell = { url: https(v['shell-url']), ...shellArtifact };
}
const privateKey = createPrivateKey(fs.readFileSync(v['private-key']));
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release metadata requires an Ed25519 signing key');
const payload = Buffer.from(JSON.stringify(release));
fs.writeFileSync(v.out, JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }) + '\n', { flag: 'wx', mode: 0o644 });
console.info(`Signed release ${release.version}, sequence ${sequence}: ${v.out}`);
