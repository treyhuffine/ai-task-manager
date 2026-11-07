/**
 * The release feed (docs/publishing.md). Signs metadata and writes the folder that
 * gets uploaded. It uploads nothing itself, so a run can always be inspected first.
 *
 *   publish   Sign this version for every platform built, and point its channel at it.
 *   promote   Point `stable` at a version already on `latest`.
 *   refresh   Sign everything again with a later expiry, changing nothing else.
 *   withdraw  Mark a version withdrawn, so nothing moves to it again.
 *
 * Each platform has a file per channel, a file per version, and a signed index of
 * the versions kept, which is how a connected computer finds a bridge release.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export function envelope(release, privateKey) {
  const payload = Buffer.from(JSON.stringify(release));
  return { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
}
export function openEnvelope(value, publicKey) {
  const bytes = Buffer.from(value.payload, 'base64');
  if (!verify(null, bytes, publicKey, Buffer.from(value.signature, 'base64'))) throw new Error('A file in the existing feed has a bad signature');
  return JSON.parse(bytes.toString('utf8'));
}
function compareVersions(a, b) {
  const parts = value => { const [core, pre] = value.split('-', 2); return { numbers: core.split('.').map(Number), pre }; };
  const left = parts(a); const right = parts(b);
  for (let i = 0; i < 3; i++) { const delta = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0); if (delta) return delta; }
  if (left.pre === right.pre) return 0;
  return !left.pre ? 1 : !right.pre ? -1 : left.pre < right.pre ? -1 : 1;
}
const dated = (days, now) => ({ publishedAt: new Date(now).toISOString(), expiresAt: new Date(now + days * 86_400_000).toISOString() });
const write = (out, name, value) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value)}\n`);
const read = (folder, name) => { const file = path.join(folder, name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };

function updateIndex({ existing, out, platform, arch, release, key, publicKey }) {
  const name = `index-${platform}-${arch}.json`;
  const before = read(existing ?? out, name);
  const versions = before ? openEnvelope(before, publicKey).versions : [];
  const entry = release.compatibility ? [{ version: release.version, sequence: release.sequence, compatibility: release.compatibility }] : [];
  const merged = [...entry, ...versions.filter(item => item.version !== release.version)].sort((a, b) => compareVersions(b.version, a.version));
  write(out, name, envelope({ format: 1, versions: merged }, key));
}

/** Everything `publish` needs, so a test can run it without a command line. */
export function publish({ payloads, channel, key, out, existing = /** @type {string | null} */ (null), notes = '', sequence, days = 30, now = Date.now() }) {
  if (!['stable', 'latest'].includes(channel)) throw new Error('Choose stable or latest channel');
  const publicKey = createPublicKey(key);
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const payload of payloads) {
    const { version, platform, arch } = payload;
    if (existing && read(existing, `${version}-${platform}-${arch}.json`)) throw new Error(`Version ${version} is already published for ${platform}-${arch}. Publish a new version, or promote this one.`);
    const release = { format: 1, sequence, channel, ...dated(days, now), withdrawn: false, notes, ...payload };
    write(out, `${version}-${platform}-${arch}.json`, envelope(release, key));
    write(out, `${channel}-${platform}-${arch}.json`, envelope(release, key));
    // Latest gets every release, so a stable one goes there too.
    if (channel === 'stable') write(out, `latest-${platform}-${arch}.json`, envelope({ ...release, channel: 'latest' }, key));
    updateIndex({ existing, out, platform, arch, release, key, publicKey });
    written.push(`${platform}-${arch}`);
  }
  return written;
}

export function promote({ existing, version, key, out, sequence, days = 30, now = Date.now() }) {
  const publicKey = createPublicKey(key);
  fs.mkdirSync(out, { recursive: true });
  // Exactly this version: 0.2.0 isn't 0.2.0-rc.1.
  const names = fs.readdirSync(existing).filter(name => /^(.+)-(?:darwin|linux)-(?:arm64|x64)\.json$/.exec(name)?.[1] === version);
  if (!names.length) throw new Error(`Version ${version} is not on this feed`);
  for (const name of names) {
    const release = openEnvelope(read(existing, name), publicKey);
    if (release.withdrawn) throw new Error(`Version ${version} was withdrawn`);
    write(out, `stable-${release.platform}-${release.arch}.json`, envelope({ ...release, channel: 'stable', sequence, ...dated(days, now) }, key));
  }
  return names.length;
}

/** Metadata expires, so a client can't be held on an old release by a frozen feed. */
export function refresh({ existing, key, out, days = 30, now = Date.now() }) {
  const publicKey = createPublicKey(key);
  fs.mkdirSync(out, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(existing).filter(file => file.endsWith('.json'))) {
    const value = openEnvelope(read(existing, name), publicKey);
    write(out, name, envelope(value.expiresAt ? { ...value, expiresAt: new Date(now + days * 86_400_000).toISOString() } : value, key));
    count++;
  }
  return count;
}

export function withdraw({ existing, version, key, out, sequence, days = 30, now = Date.now() }) {
  const publicKey = createPublicKey(key);
  fs.mkdirSync(out, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(existing).filter(file => file.endsWith('.json') && !file.startsWith('index-'))) {
    const release = openEnvelope(read(existing, name), publicKey);
    if (release.version !== version) continue;
    write(out, name, envelope({ ...release, withdrawn: true, sequence, ...dated(days, now) }, key));
    count++;
  }
  if (!count) throw new Error(`Version ${version} is not on this feed`);
  return count;
}

/** The install script, with this feed and key written in. */
export function writeInstallScript({ template, feed, key, out }) {
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  const script = fs.readFileSync(template, 'utf8').replaceAll('__RI_FEED__', feed).replaceAll('__RI_PUBLIC_KEY_BASE64__', Buffer.from(publicKey).toString('base64'));
  fs.writeFileSync(path.join(out, 'install.sh'), script, { mode: 0o755 });
}

function loadKey(values) {
  const text = values['private-key'] ? fs.readFileSync(values['private-key'], 'utf8') : process.env.RI_RELEASE_SIGNING_KEY;
  if (!text) throw new Error('Give --private-key, or set RI_RELEASE_SIGNING_KEY');
  const key = createPrivateKey(text);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Release metadata requires an Ed25519 signing key');
  return key;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [command] = process.argv.slice(2);
  const { values: v } = parseArgs({ args: process.argv.slice(3), options: {
    payloads: { type: 'string' }, channel: { type: 'string', default: 'latest' }, 'private-key': { type: 'string' }, out: { type: 'string' },
    existing: { type: 'string' }, notes: { type: 'string' }, sequence: { type: 'string' }, version: { type: 'string' }, feed: { type: 'string' },
    'expires-days': { type: 'string', default: '30' },
  } });
  if (!v.out) throw new Error('Missing --out');
  const key = loadKey(v);
  const days = Number(v['expires-days']);
  const sequence = v.sequence ? Number(v.sequence) : Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isInteger(days) || days < 1 || days > 90) throw new Error('Check --sequence and --expires-days');
  if (command === 'publish') {
    if (!v.payloads) throw new Error('Missing --payloads');
    const payloads = fs.readdirSync(v.payloads).filter(name => name.endsWith('.payload.json')).map(name => JSON.parse(fs.readFileSync(path.join(v.payloads, name), 'utf8')));
    if (!payloads.length) throw new Error('No platform metadata to publish');
    const versions = new Set(payloads.map(item => item.version));
    if (versions.size !== 1) throw new Error(`Platforms disagree about the version: ${[...versions].join(', ')}`);
    const written = publish({ payloads, channel: v.channel, key, out: v.out, existing: v.existing, sequence, days, notes: v.notes ? fs.readFileSync(v.notes, 'utf8').slice(0, 10000) : '' });
    if (v.feed) writeInstallScript({ template: fileURLToPath(new URL('../scripts/install.sh', import.meta.url)), feed: v.feed, key, out: v.out });
    console.info(`Signed ${[...versions][0]} on ${v.channel} for ${written.join(', ')} into ${v.out}`);
  } else if (command === 'promote') console.info(`Pointed stable at ${v.version} for ${promote({ existing: v.existing, version: v.version, key, out: v.out, sequence, days })} platforms`);
  else if (command === 'refresh') console.info(`Signed ${refresh({ existing: v.existing, key, out: v.out, days })} files with a later expiry`);
  else if (command === 'withdraw') console.info(`Withdrew ${v.version} in ${withdraw({ existing: v.existing, version: v.version, key, out: v.out, sequence, days })} files`);
  else throw new Error('Use publish, promote, refresh or withdraw');
}
