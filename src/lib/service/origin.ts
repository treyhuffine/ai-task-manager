/**
 * Where this computer's releases come from, and how it updates (docs/always-on-spec.md
 * sections 7.1, 7.3 and 8). One setting for the whole installation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { getRuntimeBaseDir } from './paths';

export const OriginSchema = z.object({
  version: z.literal(1),
  /** Published releases, or a checkout this computer builds when asked. */
  source: z.enum(['published', 'checkout']),
  checkout: z.string().min(1).optional(),
  channel: z.enum(['stable', 'latest']),
  /** Automatic updates. Applies to published releases only. */
  auto: z.boolean(),
  /** Hold automatic downloads, on a connection someone pays for by the byte. */
  metered: z.boolean().optional(),
}).strict();
export type Origin = z.infer<typeof OriginSchema>;

const DEFAULT_ORIGIN: Origin = { version: 1, source: 'published', channel: 'stable', auto: true };

function originFile(base = getRuntimeBaseDir()) { return path.join(/* turbopackIgnore: true */ base, 'origin.json'); }

export function readOrigin(base = getRuntimeBaseDir()): Origin {
  try { return OriginSchema.parse(JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ originFile(base), 'utf8'))); }
  catch { return { ...DEFAULT_ORIGIN }; }
}

export function writeOrigin(change: Partial<Omit<Origin, 'version'>>, base = getRuntimeBaseDir()): Origin {
  const next = OriginSchema.parse({ ...readOrigin(base), ...change, version: 1 });
  if (next.source === 'published') delete next.checkout;
  else if (!next.checkout) throw new Error('Name the checkout to build from: ri update --from <folder>');
  fs.mkdirSync(/* turbopackIgnore: true */ base, { recursive: true, mode: 0o700 });
  atomicWriteFile(originFile(base), JSON.stringify(next));
  return next;
}

/** `--from <folder>` or `--from published`. A folder must be a git checkout of Ri. */
export function parseFrom(value: string, cwd = process.cwd()): Pick<Origin, 'source' | 'checkout'> {
  if (value === 'published') return { source: 'published' };
  const checkout = path.resolve(/* turbopackIgnore: true */ cwd, value.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ checkout, '.git'))) throw new Error(`${checkout} isn't a git checkout. Name a checkout of Ri, or "published".`);
  if (!fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ checkout, 'desktop/package.mjs'))) throw new Error(`${checkout} doesn't look like a checkout of Ri (no desktop/package.mjs).`);
  return { source: 'checkout', checkout: fs.realpathSync(/* turbopackIgnore: true */ checkout) };
}
