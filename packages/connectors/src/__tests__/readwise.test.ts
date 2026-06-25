/** Readwise connector — API-token connect (Token header), then highlight/book reads. */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerReadwise } from '../providers/readwise';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup(handler: (c: FakeHttpCall) => { status?: number; json?: unknown }) {
  const http = fakeHttp(async (c) => handler(c));
  const registry = createRegistry();
  registerReadwise(registry);
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime };
}

describe('readwise', () => {
  it('connects with an API token and lists highlights (Token auth header)', async () => {
    let auth: string | undefined;
    const s = setup((c) => {
      auth = c.headers.authorization;
      return { json: { count: 1, results: [{ id: 1, text: 'a highlight' }] } };
    });
    await s.runtime.connectDirect('readwise', { credential: { type: 'api_key', apiKey: 'KEY' } });
    const out = await s.runtime.runAction('readwise.list_highlights', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { count: number } }).result.count).toBe(1);
    expect(auth).toBe('Token KEY');
  });

  it('reads Reader documents from the v3 host (absolute URL)', async () => {
    let url = '';
    const s = setup((c) => {
      url = c.url;
      return { json: { count: 0, results: [] } };
    });
    await s.runtime.connectDirect('readwise', { credential: { type: 'api_key', apiKey: 'KEY' } });
    const out = await s.runtime.runAction('readwise.list_documents', { location: 'new' });
    expect(out.ok).toBe(true);
    expect(url.startsWith('https://readwise.io/api/v3/list/')).toBe(true);
  });
});
