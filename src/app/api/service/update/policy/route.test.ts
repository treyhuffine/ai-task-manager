import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/service/owner-auth', () => ({ isInstallationOwner: mocks.owner }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mocks.request }));
import { PATCH } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockReturnValue(true); mocks.request.mockResolvedValue({ policy: { channel: 'stable', automaticDownload: true, metered: true } }); });
const request = (body: unknown) => new NextRequest('https://localhost/api/service/update/policy', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

it('refuses paired-device and other non-owner requests before contacting the controller', async () => {
  mocks.owner.mockReturnValue(false);
  expect((await PATCH(request({ metered: true }))).status).toBe(403);
  expect(mocks.request).not.toHaveBeenCalled();
});
it('forwards only a validated preference patch to the private owner', async () => {
  const response = await PATCH(request({ metered: true }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.request).toHaveBeenCalledWith('/update/policy', 'PATCH', 3000, { metered: true });
});
it.each([{ automaticDownload: true, feed: 'https://attacker.example' }, { publicKey: 'attacker' }, { channel: 'beta' }, {}, { metered: 'yes' }])('rejects an unauthorized policy shape %j', async body => {
  expect((await PATCH(request(body))).status).toBe(400);
  expect(mocks.request).not.toHaveBeenCalled();
});
it('bounds the request and reports controller failures without claiming success', async () => {
  expect((await PATCH(request({ metered: true, excess: 'x'.repeat(5000) }))).status).toBe(400);
  expect(mocks.request).not.toHaveBeenCalled();
  mocks.request.mockRejectedValue(new Error('Another update action is in progress'));
  const response = await PATCH(request({ metered: true }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'Another update action is in progress' });
});
