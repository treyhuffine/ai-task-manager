import fs from 'node:fs';
import path from 'node:path';
import { verify } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { getRuntimeBaseDir } from './paths';
import { readOrigin, writeOrigin } from './origin';
import { UpdatePreferencesSchema, type ReleasePreferences } from './update-settings';
import { RuntimeCompatibilitySchema } from '@/lib/releases/compatibility';

const httpsUrl = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ReleaseSchema = z.object({
  format: z.literal(1), sequence: z.number().int().positive(), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/),
  channel: z.enum(['stable', 'latest']), publishedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  platform: z.enum(['darwin', 'linux']), arch: z.enum(['arm64', 'x64']), minimumUpdater: z.literal(1),
  apiProtocol: z.literal(1), configFormat: z.literal(1), withdrawn: z.boolean(), notes: z.string().max(10000),
  // Exact migration-prefix checks against the target's signed files are the
  // schema compatibility contract. Baseline squashes require a bridge release.
  migrationHistory: digest,
  // `id` says what the app's own part is, so an unchanged one isn't downloaded again (section 4.2).
  shell: z.object({ url: httpsUrl, sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/), size: z.number().int().positive().max(4 * 1024 ** 3), id: digest.optional() }).strict().optional(),
  runtime: z.object({ id: digest, url: httpsUrl, sha256: digest, size: z.number().int().positive().max(4 * 1024 ** 3), unpackedSize: z.number().int().positive().max(16 * 1024 ** 3) }).strict(),
  /** What it can talk to, so a connected computer can tell before downloading (section 7.7). */
  compatibility: RuntimeCompatibilitySchema.optional(),
}).strict();
export type Release = z.infer<typeof ReleaseSchema>;
/** What a release ships: where to look and whose signature to trust. Neither
 * ever changes on a computer. The person's choices live in the origin. */
const ReleasePolicySchema = z.object({ format: z.literal(1), feed: httpsUrl, publicKey: z.string().min(1).max(16000) }).strict();
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema> & ReleasePreferences;

/** One file per channel and platform, one per version and platform, and an
 * index of the versions kept (docs/publishing.md). */
export function feedFile(policy: Pick<ReleasePolicy, 'feed'>, name: string, platform: string = process.platform, arch: string = process.arch) {
  return new URL(`${name}-${platform}-${arch}.json`, policy.feed.endsWith('/') ? policy.feed : `${policy.feed}/`).href;
}

/** One per computer, like the store: the first release staged here brings it. */
export function releasePolicyFile(base = getRuntimeBaseDir()) { return path.join(/* turbopackIgnore: true */ base, 'release-policy.json'); }

export function releasePolicy(): ReleasePolicy | null {
  const file = releasePolicyFile();
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) return null;
  return { ...ReleasePolicySchema.parse(JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, 'utf8'))), ...releasePreferences() };
}
export function releasePreferences(): ReleasePreferences {
  const origin = readOrigin();
  return { channel: origin.channel, auto: origin.auto, metered: !!origin.metered };
}
/** Called only by the single controller owner, never by the renderer or Next
 * process directly. The package-installed trust anchors remain untouched. */
export function updateReleasePreferences(input: unknown): ReleasePreferences {
  writeOrigin(UpdatePreferencesSchema.parse(input));
  return releasePreferences();
}
export function verifyRelease(envelope: unknown, policy: Pick<ReleasePolicy, 'publicKey' | 'channel'>, minimumSequence = 0, now = Date.now()): Release {
  const { payload, signature } = z.object({ payload: z.string().max(128000), signature: z.string().max(200) }).strict().parse(envelope);
  const bytes = Buffer.from(payload, 'base64');
  if (!verify(null, bytes, policy.publicKey, Buffer.from(signature, 'base64'))) throw new Error('Release publisher signature is invalid');
  const release = ReleaseSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (release.channel !== policy.channel || release.platform !== process.platform || release.arch !== process.arch) throw new Error('Release does not match this installation');
  if (release.sequence < minimumSequence) throw new Error('Release feed attempted a downgrade');
  if (Date.parse(release.expiresAt) <= now || Date.parse(release.publishedAt) > now + 5 * 60_000) throw new Error('Release metadata expired or has an invalid date');
  if (release.withdrawn) throw new Error('This release was withdrawn by its publisher');
  return release;
}
/** A slow connection is fine, however long the download takes. Only one that has
 * stopped moving gives up, so the next check can try again. */
export async function secureFetch(url: string, stallMs = 2 * 60_000): Promise<Response> {
  for (let i = 0; i < 6; i++) {
    httpsUrl.parse(url);
    const stalled = new AbortController();
    let timer = setTimeout(() => stalled.abort(new Error('The download stopped moving.')), stallMs);
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => stalled.abort(new Error('The download stopped moving.')), stallMs); };
    let response: Response;
    try { response = await fetch(url, { redirect: 'manual', signal: stalled.signal }); }
    catch (error) { clearTimeout(timer); throw error; }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      await response.body?.cancel();
      url = new URL(response.headers.get('location') ?? '', url).href;
      continue;
    }
    if (!response.ok || !response.body) { clearTimeout(timer); throw new Error(`Release download failed (${response.status})`); }
    watch();
    return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { watch(); controller.enqueue(chunk); },
      flush() { clearTimeout(timer); },
    })), { status: response.status, headers: response.headers });
  }
  throw new Error('Release download redirected too many times');
}
async function fetchEnvelope(url: string) {
  const response = await secureFetch(url);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    bytes += chunk.length;
    if (bytes > 256_000) throw new Error('Release metadata is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
/** The newest pointer seen on a channel, so a feed can't move it backwards. Each
 * channel has its own: `stable` is often behind `latest`, on purpose. */
function seenSequence(channel: ReleasePreferences['channel']) {
  const seenFile = path.join(/* turbopackIgnore: true */ getRuntimeBaseDir(), `release-sequence-${channel}`);
  const seen = fs.existsSync(/* turbopackIgnore: true */ seenFile) ? Number(fs.readFileSync(/* turbopackIgnore: true */ seenFile, 'utf8')) : 0;
  if (!Number.isSafeInteger(seen) || seen < 0) throw new Error('Invalid saved release sequence');
  return { seen, seenFile };
}
const notConfigured = 'Updates are not configured. This build needs a publisher public key and HTTPS release feed.';
export async function checkRelease(): Promise<Release> {
  const policy = releasePolicy();
  if (!policy) throw new Error(notConfigured);
  const { seen, seenFile } = seenSequence(policy.channel);
  const release = verifyRelease(await fetchEnvelope(feedFile(policy, policy.channel)), policy, seen);
  atomicWriteFile(seenFile, `${release.sequence}\n`);
  return release;
}
/** One version by number, whichever channel it came from: to check it's still good
 * before using it, or the version a connected computer's Home runs (section 7.7).
 * Asking for a version says nothing about a channel's order, so no sequence applies. */
export async function checkReleaseVersion(version: string): Promise<Release> {
  const policy = releasePolicy();
  if (!policy) throw new Error(notConfigured);
  const envelope = await fetchEnvelope(feedFile(policy, version));
  const release = verifyRelease(envelope, { ...policy, channel: readEnvelopeChannel(envelope) });
  if (release.version !== version) throw new Error('The release feed answered with a different version');
  return release;
}
const VersionIndexSchema = z.object({ format: z.literal(1), versions: z.array(z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/), sequence: z.number().int().positive(), compatibility: RuntimeCompatibilitySchema,
}).strict()).max(500) }).strict();
/** The versions kept on the feed for this platform, newest first, for finding a bridge. */
export async function checkReleaseIndex() {
  const policy = releasePolicy();
  if (!policy) throw new Error(notConfigured);
  const { payload, signature } = z.object({ payload: z.string().max(128000), signature: z.string().max(200) }).strict().parse(await fetchEnvelope(feedFile(policy, 'index')));
  const bytes = Buffer.from(payload, 'base64');
  if (!verify(null, bytes, policy.publicKey, Buffer.from(signature, 'base64'))) throw new Error('Release publisher signature is invalid');
  return VersionIndexSchema.parse(JSON.parse(bytes.toString('utf8'))).versions;
}
function readEnvelopeChannel(envelope: { payload?: unknown }) {
  // Only used to accept either channel. verifyRelease checks the signature over these same bytes.
  return (JSON.parse(Buffer.from(String(envelope.payload), 'base64').toString('utf8')) as { channel: ReleasePreferences['channel'] }).channel;
}
