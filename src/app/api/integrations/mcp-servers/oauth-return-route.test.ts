import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as add } from './route';
import { POST as reconnect } from './[id]/route';

const mocks = vi.hoisted(() => ({ begin: vi.fn(), create: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/integrations/mcp-authorization', () => ({ beginMcpAuthorization: mocks.begin }));
vi.mock('@/lib/integrations/runtime', () => ({ getMcpServerStore: () => ({
  get: mocks.get, create: mocks.create, getBySlug: () => null, list: () => [],
}) }));
const entry = { id: 'test-server', slug: 'test', displayName: 'Test', url: 'https://mcp.example.test', enabled: true, auth: { kind: 'oauth' }, createdAt: 'then', updatedAt: 'then' };
beforeEach(() => {
  vi.resetAllMocks(); mocks.create.mockResolvedValue(entry); mocks.get.mockReturnValue(entry);
  mocks.begin.mockResolvedValue({ requiresAuth: true, authUrl: 'https://auth.example.test' });
});
const request = (body: unknown) => new NextRequest('https://ri.example.test/api/integrations/mcp-servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

it.each([['/apps?filter=connectors', '/apps?filter=connectors'], [undefined, undefined], ['https://other.example.test', undefined], ['//other.example.test', undefined]])('returns new MCP sign-ins to an in-app destination only: %s', async (returnTo, expected) => {
  const response = await add(request({ name: 'Test', url: entry.url, auth: entry.auth, returnTo }));
  expect(response.status).toBe(201);
  expect(mocks.begin).toHaveBeenCalledWith(entry, expect.anything(), expected);
});

it.each([['/apps?mcp=test-server', '/apps?mcp=test-server'], [undefined, undefined], ['/\\other.example.test', undefined]])('returns existing MCP sign-ins to Apps while retaining the Settings default: %s', async (returnTo, expected) => {
  const response = await reconnect(request({ returnTo }), { params: Promise.resolve({ id: entry.id }) });
  expect(response.status).toBe(200);
  expect(mocks.begin).toHaveBeenCalledWith(entry, expect.anything(), expected);
});
