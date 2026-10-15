import { describe, expect, it } from 'vitest';
import { filterLibrary, libraryItems, libraryLocation, libraryRoute, type LibrarySources } from './library-model';

const timestamps = { createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const source: LibrarySources = {
  providers: [{ id: 'google', displayName: 'Google', method: 'oauth2', configured: true }, { id: 'mcp_receipts', displayName: 'MCP: receipts', method: 'api_key', configured: true }],
  connections: [
    { ...timestamps, ownerId: 'local', id: 'g1', providerId: 'google', accountId: 'work', label: 'Work', status: 'active', scopes: [] },
    { ...timestamps, ownerId: 'local', id: 'g2', providerId: 'google', accountId: 'personal', label: 'Personal', status: 'active', scopes: [] },
    { ...timestamps, ownerId: 'local', id: 'c1', providerId: 'mcp_receipts', accountId: 'receipts', status: 'active', scopes: [] },
  ],
  servers: [
    { ...timestamps, id: 'custom', slug: 'receipts', displayName: 'Receipts', url: 'https://example.test/mcp', enabled: true, auth: { kind: 'none' }, lastStatus: 'ok' },
    { ...timestamps, id: 'hosted', providerId: 'google', slug: 'builtin_google', displayName: 'Google', url: 'https://google.example.test/mcp', enabled: true, auth: { kind: 'oauth' }, lastStatus: 'ok' },
  ],
};

describe('Apps library identity and capabilities', () => {
  it('groups accounts by provider and never lists a custom or hosted MCP connection twice', () => {
    const rows = libraryItems(source);
    expect(rows.map(row => row.key)).toEqual(['provider:google', 'mcp:custom']);
    expect(rows[0].status).toBe('2 accounts');
    expect(filterLibrary(rows, 'yours', 'all', 'personal')).toEqual([rows[0]]);
    expect(rows[0].target).toEqual({ kind: 'provider', id: 'google' });
  });
  it('keeps interrupted setup in the library and unconnected providers in discovery only', () => {
    const rows = libraryItems({ ...source, connections: [], providers: [...source.providers!, { id: 'linear', displayName: 'Linear', method: 'mcp', configured: true }] });
    expect(filterLibrary(rows, 'yours', 'all', '').map(row => row.name)).toEqual(['Google', 'Receipts']);
    expect(filterLibrary(rows, 'discover', 'connectors', 'linear').map(row => row.name)).toEqual(['Linear']);
    expect(rows.find(row => row.name === 'Google')?.status).toBe('Finish setup');
  });
  it('can show connections and skills with no local app runtime', () => {
    const rows = libraryItems({ ...source, skills: [{ ref: 'ri:review', name: 'Weekly review', description: 'Review the week', hasErrors: false, location: { kind: 'ri' } }] as LibrarySources['skills'] });
    expect(filterLibrary(rows, 'yours', 'skills', 'review').map(row => row.key)).toEqual(['skill:ri:review']);
    expect(rows.find(row => row.kind === 'skills')).toMatchObject({ chat: true, view: false });
  });
  it('does not promise a launcher for connections that Ri only supports as tools', () => {
    expect(libraryItems(source).every(row => !row.view)).toBe(true);
  });
  it('keeps unavailable accounts and retired providers manageable', () => {
    const rows = libraryItems({ providers: [], connections: [{ ...timestamps, ownerId: 'local', id: 'old', providerId: 'old-service', accountId: 'work', status: 'needs_reauth', scopes: [] }] });
    expect(rows[0]).toMatchObject({ added: true, attention: true, target: { kind: 'provider', id: 'old-service' } });
  });
});

it('keeps catalog location and search while opening and returning from setup', () => {
  const query = { browse: 'discover', filter: 'connectors', q: 'work mail' };
  const opened = libraryRoute(query, { provider: 'google' });
  const location = Object.fromEntries(new URLSearchParams(opened));
  expect(libraryLocation(location)).toMatchObject({ mode: 'discover', filter: 'connectors', search: 'work mail', provider: 'google' });
  expect(libraryRoute(location, { provider: undefined })).toBe('?browse=discover&filter=connectors&q=work+mail');
  expect(libraryLocation({ filter: 'something-unknown' }).filter).toBe('all');
});
