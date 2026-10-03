import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, PATCH } from './route';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/service/owner-auth', () => ({ isInstallationOwner: mocks.owner }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mocks.request }));
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockReturnValue(true); mocks.request.mockResolvedValue({ awake: { enabled: false, phase: 'off', power: 'unknown', detail: 'Disabled' } }); });
const request = (body?: unknown) => new NextRequest('https://localhost/api/service/awake', body === undefined ? {} : { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
it('rejects non-owner reads and writes before contacting the service', async () => {
  mocks.owner.mockReturnValue(false);
  expect((await GET(request())).status).toBe(403);
  expect((await PATCH(request({ enabled: true }))).status).toBe(403);
  expect(mocks.request).not.toHaveBeenCalled();
});
it('forwards a bounded validated owner choice to the private service', async () => {
  const result = await PATCH(request({ enabled: true }));
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/awake', 'PATCH', 10_000, { enabled: true });
});
it.each([{}, { enabled: 'yes' }, { enabled: true, command: 'evil' }, { enabled: false, extra: 'x'.repeat(2000) }])('rejects arbitrary control payload %j', async body => {
  expect((await PATCH(request(body))).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled();
});
it('returns fresh status and an explicit unavailable response when the service cannot be read', async () => {
  const result = await GET(request()); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(await result.json()).toEqual({ awake: { enabled: false, phase: 'off', power: 'unknown', detail: 'Disabled' } });
  mocks.request.mockRejectedValue(new Error('disconnected'));
  expect((await GET(request())).status).toBe(503);
  expect((await PATCH(request({ enabled: false }))).status).toBe(400);
});
