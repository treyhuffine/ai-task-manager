/**
 * Live access to a managed source: its preferences entry, its opened credential and a client.
 * Every call site goes through here, so "is this source usable right now" has one answer that
 * reads the files each time (another process may have disabled or removed the source).
 */
import { processState } from '@/lib/process-state';
import { createComposioClient, type ComposioClient } from './composio/client';
import { currentPreferences, readPreferences } from './preferences';
import { openSourceCredential, sourceCredentialRevision } from './source-credentials';
import type { SourceEntry } from './types';

/** Test and fake-server seam: where the Composio client sends requests. */
const transport = processState('integrations.composio-transport', () => ({
  fetch: undefined as typeof fetch | undefined,
  baseUrl: undefined as string | undefined,
}));

export function setComposioTransport(next: { fetch?: typeof fetch; baseUrl?: string } | null): void {
  transport.fetch = next?.fetch;
  transport.baseUrl = next?.baseUrl;
}

/**
 * Development only: `RI_COMPOSIO_API_BASE` points the client at a local stand-in
 * (`scripts/dev-fake-composio.ts`), so the whole flow can run in a browser without a real
 * project. Ignored in production, and for anything but a loopback address, so a key can never
 * be sent to another host this way.
 */
function devApiBase(): string | undefined {
  const raw = process.env.RI_COMPOSIO_API_BASE;
  if (!raw || process.env.NODE_ENV === 'production') return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') ? url.href.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
}

export function composioClient(apiKey: string): ComposioClient {
  const baseUrl = transport.baseUrl ?? devApiBase();
  return createComposioClient({ apiKey, ...(transport.fetch ? { fetch: transport.fetch } : {}), ...(baseUrl ? { baseUrl } : {}) });
}

export interface OpenSource {
  source: SourceEntry;
  apiKey: string;
  revision: string;
  client: ComposioClient;
}

export function findSource(sourceId: string): SourceEntry | null {
  return currentPreferences().sources.find(source => source.id === sourceId) ?? null;
}

/** Enabled, with a stored credential. Cheap and synchronous: no decryption, no network. */
export function sourceUsable(sourceId: string): boolean {
  const read = readPreferences();
  if (read.status !== 'ok') return false;
  const source = read.preferences.sources.find(candidate => candidate.id === sourceId);
  return Boolean(source?.enabled && sourceCredentialRevision(sourceId));
}

/** The source with its opened credential, or null when it is missing, disabled or has no key. */
export async function openSource(sourceId: string, opts: { includeDisabled?: boolean } = {}): Promise<OpenSource | null> {
  const source = findSource(sourceId);
  if (!source || (!source.enabled && !opts.includeDisabled)) return null;
  const credential = await openSourceCredential(sourceId);
  if (!credential) return null;
  return { source, apiKey: credential.apiKey, revision: credential.revision, client: composioClient(credential.apiKey) };
}
