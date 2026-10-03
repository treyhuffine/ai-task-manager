import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/service/owner-auth', () => ({ isInstallationOwner: mocks.owner }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mocks.request }));
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockReturnValue(true); mocks.request.mockResolvedValue({ update: { format: 1, phase: 'waiting', changedAt: '2026-10-03', configured: true, busy: false, policy: null } }); });
const request = (body: unknown) => new NextRequest('https://localhost/api/service/update', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
it('requires the owner credential for activation', async () => {
  mocks.owner.mockReturnValue(false);
  expect((await POST(request({ action: 'apply' }))).status).toBe(403);
  expect(mocks.request).not.toHaveBeenCalled();
});
it('passes a valid schedule unchanged to the coordinator', async () => {
  const body = { action: 'when-idle', window: { hour: 23, durationHours: 3, timeZone: 'America/Denver' } };
  expect((await POST(request(body))).status).toBe(200);
  expect(mocks.request).toHaveBeenCalledWith('/update', 'POST', 3000, body);
});
it('rejects invalid zones and a window on immediate activation', async () => {
  expect((await POST(request({ action: 'when-idle', window: { hour: 3, durationHours: 2, timeZone: 'invalid' } }))).status).toBe(400);
  expect((await POST(request({ action: 'apply', window: { hour: 3, durationHours: 2, timeZone: 'UTC' } }))).status).toBe(400);
  expect(mocks.request).not.toHaveBeenCalled();
});
