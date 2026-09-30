import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), status: vi.fn() }));
vi.mock('@/lib/service/owner-auth', () => ({ isInstallationOwner: mocks.owner }));
vi.mock('@/lib/service/client', () => ({ serviceStatus: mocks.status }));
import { GET } from './route';
const request = () => new NextRequest('https://localhost/api/service');
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockReturnValue(false); });

it('does not expose local startup excerpts or retained update errors to paired devices', async () => {
  const status = { phase: 'failed', error: 'Next.js: Error: private-local-diagnostic', update: { phase: 'recovery-required', error: 'Startup failed: private-update-diagnostic' } };
  mocks.status.mockResolvedValue(status);
  const response = await GET(request());
  const body = await response.json();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(body).toMatchObject({ phase: 'failed', canManage: false, update: { phase: 'recovery-required' } });
  expect(body.error).toContain('local recovery window');
  expect(body.update.error).toContain('local recovery window');
  expect(JSON.stringify(body)).not.toContain('private-');
  expect(status.error).toContain('private-local-diagnostic');
});

it('keeps detailed diagnostics available to the installation owner', async () => {
  mocks.owner.mockReturnValue(true);
  const status = { phase: 'failed', error: 'Next.js: Error: actionable cause', update: { phase: 'recovery-required', error: 'Startup failed: actionable cause' } };
  mocks.status.mockResolvedValue(status);
  expect(await (await GET(request())).json()).toEqual({ ...status, canManage: true });
});

it('preserves healthy and unmanaged status without inventing failures', async () => {
  mocks.status.mockResolvedValue({ phase: 'running', update: { phase: 'idle' } });
  expect(await (await GET(request())).json()).toEqual({ phase: 'running', update: { phase: 'idle' }, canManage: false });
  mocks.status.mockResolvedValue(null);
  expect(await (await GET(request())).json()).toEqual({ phase: 'unmanaged', canManage: false });
});
