import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { isInstallationOwner } from './owner-auth';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
vi.mock('@/lib/auth/config-file', () => ({ readAuthConfig: () => ({ localToken: 'installation-owner' }) }));
it('rejects device and harness credentials as update authority', () => {
  for (const credential of ['device-token', 'harness-token', '']) expect(isInstallationOwner(new NextRequest('https://host/api/service/update', { headers: { authorization: `Bearer ${credential}` } }))).toBe(false);
});
it('accepts only the original installation credential through bearer or cookie', () => {
  expect(isInstallationOwner(new NextRequest('https://host/api/service/update', { headers: { authorization: 'Bearer installation-owner' } }))).toBe(true);
  expect(isInstallationOwner(new NextRequest('https://host/api/service/update', { headers: { cookie: `${SESSION_COOKIE_NAME}=installation-owner` } }))).toBe(true);
});
