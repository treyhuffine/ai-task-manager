/** Create authenticated release metadata. Does not upload or publish anything. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values: v } = parseArgs({ options: {
  resources: { type: 'string' }, runtime: { type: 'string' }, 'runtime-url': { type: 'string' },
  shell: { type: 'string' }, 'shell-url': { type: 'string' }, sequence: { type: 'string' },
  'private-key': { type: 'string' }, out: { type: 'string' }, notes: { type: 'string' },
  channel: { type: 'string', default: 'stable' }, 'expires-days': { type: 'string', default: '7' },
} });
for (const key of ['resources', 'runtime', 'runtime-url', 'sequence', 'private-key', 'out']) if (!v[key]) throw new Error(`Missing --${key}`);
const manifest = JSON.parse(fs.readFileSync(path.join(v.resources, 'runtime-manifest.json'), 'utf8'));
const sequence = Number(v.sequence);
const days = Number(v['expires-days']);
if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isInteger(days) || days < 1 || days > 30) throw new Error('Sequence must increase monotonically. Metadata lifetime must be 1-30 days.');
if (!['stable', 'beta'].includes(v.channel)) throw new Error('Choose stable or beta channel');
function https(value) { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Artifact URLs must use HTTPS'); return u.href; }
function digest(file, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm); const buffer = Buffer.alloc(1024 * 1024); const fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest(encoding);
}
function totalSize(directory) {
  let size = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) size += totalSize(file);
    else if (entry.isFile()) size += fs.statSync(file).size;
  }
  return size;
}
const release = {
  format: 1, sequence, version: manifest.version, channel: v.channel,
  publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
  platform: manifest.platform, arch: manifest.arch, minimumUpdater: 1, apiProtocol: 1, configFormat: 1,
  withdrawn: false, notes: v.notes ? fs.readFileSync(v.notes, 'utf8') : '',
  migrationHistory: digest(path.join(v.resources, 'server/drizzle/meta/_journal.json')),
  runtime: { id: manifest.id, url: https(v['runtime-url']), sha256: digest(v.runtime), size: fs.statSync(v.runtime).size,
    unpackedSize: totalSize(v.resources) },
};
if (v.shell || v['shell-url']) {
  if (!v.shell || !v['shell-url']) throw new Error('Supply both --shell and --shell-url');
  release.shell = { url: https(v['shell-url']), sha512: digest(v.shell, 'sha512', 'base64'), size: fs.statSync(v.shell).size };
}
const privateKey = createPrivateKey(fs.readFileSync(v['private-key']));
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release metadata requires an Ed25519 signing key');
const payload = Buffer.from(JSON.stringify(release));
fs.writeFileSync(v.out, JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }) + '\n', { flag: 'wx', mode: 0o644 });
console.info(`Signed release ${release.version}, sequence ${sequence}: ${v.out}`);
