/**
 * Source credentials (a Composio project API key), sealed with the home's integration key and
 * keyed by source id, in `<config-dir>/integrations/source-credentials.json`. The preferences file
 * never holds one. Only the home server opens them, and every opened value is registered with the
 * redactor by its caller before it can reach a result, log or error.
 *
 * `revision` changes on every save, so another process can tell a rotated key from the one it
 * cached without opening it.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getIntegrationSecretBox, getIntegrationsDir } from '../storage';
import { SOURCE_ID_PATTERN } from './applications';

export const SOURCE_CREDENTIALS_FILE = 'source-credentials.json';

export interface SourceCredential {
  apiKey: string;
}

const entrySchema = z.object({ sealed: z.string().min(1), revision: z.string().min(1), updatedAt: z.string().min(1) }).strict();
const documentSchema = z.object({ version: z.literal(1), entries: z.record(z.string().regex(SOURCE_ID_PATTERN), entrySchema) }).strict();
type CredentialDocument = z.infer<typeof documentSchema>;

function credentialsPath(dir: string): string {
  return path.join(dir, SOURCE_CREDENTIALS_FILE);
}

function readDocument(dir: string): CredentialDocument {
  const file = credentialsPath(dir);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: {} };
    throw error;
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = undefined; }
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} can't be read. It was left unchanged. Repair or move it, then enter the source key again.`);
  return parsed.data;
}

/** Seal and store a source's credential, replacing any earlier one. Returns its new revision. */
export async function saveSourceCredential(sourceId: string, credential: SourceCredential, dir = getIntegrationsDir()): Promise<string> {
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error('Invalid source id.');
  const sealed = await getIntegrationSecretBox().seal(credential);
  const revision = randomBytes(8).toString('hex');
  const file = credentialsPath(dir);
  withFileLock(file, () => {
    const document = readDocument(dir);
    document.entries[sourceId] = { sealed, revision, updatedAt: new Date().toISOString() };
    atomicWriteFile(file, `${JSON.stringify(document, null, 2)}\n`);
  });
  return revision;
}

/** The opened credential and its revision, or null when the source has none. */
export async function openSourceCredential(sourceId: string, dir = getIntegrationsDir()): Promise<(SourceCredential & { revision: string }) | null> {
  const entry = readDocument(dir).entries[sourceId];
  if (!entry) return null;
  const opened = await getIntegrationSecretBox().open<unknown>(entry.sealed);
  const parsed = z.object({ apiKey: z.string().min(1) }).safeParse(opened);
  if (!parsed.success) return null;
  return { apiKey: parsed.data.apiKey, revision: entry.revision };
}

/** The current revision without opening the credential (for change detection). */
export function sourceCredentialRevision(sourceId: string, dir = getIntegrationsDir()): string | undefined {
  try {
    return readDocument(dir).entries[sourceId]?.revision;
  } catch {
    return undefined;
  }
}

export function deleteSourceCredential(sourceId: string, dir = getIntegrationsDir()): void {
  const file = credentialsPath(dir);
  withFileLock(file, () => {
    const document = readDocument(dir);
    if (!document.entries[sourceId]) return;
    delete document.entries[sourceId];
    atomicWriteFile(file, `${JSON.stringify(document, null, 2)}\n`);
  });
}
