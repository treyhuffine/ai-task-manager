import fs from 'node:fs';
import path from 'node:path';
import { verify } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { getRuntimeInstallDir } from './paths';

const httpsUrl = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const ReleaseSchema = z.object({
  format: z.literal(1), sequence: z.number().int().positive(), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/),
  channel: z.enum(['stable', 'beta']), publishedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  platform: z.enum(['darwin', 'linux']), arch: z.enum(['arm64', 'x64']), minimumUpdater: z.literal(1),
  apiProtocol: z.literal(1), configFormat: z.literal(1), withdrawn: z.boolean(), notes: z.string().max(10000),
  // Exact migration-prefix checks against the target's signed files are the
  // schema compatibility contract. Baseline squashes require a bridge release.
  migrationHistory: digest,
  shell: z.object({ url: httpsUrl, sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/), size: z.number().int().positive().max(4 * 1024 ** 3) }).strict().optional(),
  runtime: z.object({ id: digest, url: httpsUrl, sha256: digest, size: z.number().int().positive().max(4 * 1024 ** 3), unpackedSize: z.number().int().positive().max(16 * 1024 ** 3) }).strict(),
}).strict();
export type Release = z.infer<typeof ReleaseSchema>;
export interface ReleasePolicy { format: 1; feed: string; publicKey: string; channel: 'stable' | 'beta'; automaticDownload: boolean; metered: boolean }

export function releasePolicy(): ReleasePolicy | null {
  const file = path.join(getRuntimeInstallDir(), 'release-policy.json');
  if (!fs.existsSync(file)) return null;
  const policy = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleasePolicy;
  if (policy.format !== 1 || !['stable', 'beta'].includes(policy.channel) || !policy.publicKey) throw new Error('Invalid release policy');
  httpsUrl.parse(policy.feed);
  return policy;
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
export async function secureFetch(url: string): Promise<Response> {
  for (let i = 0; i < 6; i++) {
    httpsUrl.parse(url);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10 * 60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location') ?? '', url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Release download failed (${response.status})`);
    return response;
  }
  throw new Error('Release download redirected too many times');
}
export async function checkRelease(): Promise<Release> {
  const policy = releasePolicy();
  if (!policy) throw new Error('Updates are not configured. This build needs a publisher public key and HTTPS release feed.');
  const install = getRuntimeInstallDir();
  const seenFile = path.join(install, 'release-sequence');
  const seen = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, 'utf8')) : 0;
  if (!Number.isSafeInteger(seen) || seen < 0) throw new Error('Invalid saved release sequence');
  const response = await secureFetch(policy.feed);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of Readable.fromWeb(response.body as never)) {
    bytes += chunk.length;
    if (bytes > 256_000) throw new Error('Release metadata is too large');
    chunks.push(chunk);
  }
  const release = verifyRelease(JSON.parse(Buffer.concat(chunks).toString()), policy, seen);
  atomicWriteFile(seenFile, `${release.sequence}\n`);
  return release;
}
