import { afterEach, expect, it } from 'vitest';
import { createTestHome } from '@/test/fixtures/home';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import { resetAuthorityCache } from '@/lib/home/authority';
import { teamSessionCookieName } from '@/lib/team/credential';
import { SESSION_COOKIE_NAME } from './session';
import { pageViewerKey } from './page-key';
import * as q from '@/lib/db/queries';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; resetHomeIdentityCache(); resetAuthorityCache(); });

it('authenticates personal page cookies and ignores forged proxy headers, revoked and expired credentials', async () => {
  const home = await createTestHome(); cleanup = home.cleanup; ensureHomeIdentity();
  const browser = q.createApiKey({ name: 'Browser', role: 'sign_in', deviceId: null });
  const forged = { 'x-ri-api-key-id': browser.key.id, 'x-ri-api-key-scope': 'viewer', 'x-ri-member-id': 'invented' };
  expect(pageViewerKey(new Headers(forged))).toBeNull();
  const cookie = new Headers({ cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(browser.token.plaintext)}` });
  expect(pageViewerKey(cookie)).toMatchObject({ apiKeyId: browser.key.id, scope: 'viewer' });
  expect(pageViewerKey(new Headers({ ...forged, cookie: `${SESSION_COOKIE_NAME}=%zz` }))).toBeNull();
  expect(pageViewerKey(new Headers({ cookie: cookie.get('cookie')!, authorization: 'Bearer invalid-explicit-token' }))).toBeNull();
  q.revokeApiKey(browser.key.id, 'Fixture revoked'); expect(pageViewerKey(cookie)).toBeNull();
  const expired = q.createApiKey({ name: 'Expired browser', role: 'sign_in', deviceId: null, expiresAt: '2000-01-01T00:00:00.000Z' });
  expect(pageViewerKey(new Headers({ authorization: `Bearer ${expired.token.plaintext}` }))).toBeNull();
});

it('uses only the Team cookie and live membership and never trusts a supplied role', async () => {
  const fixture = await createTeamExecutionFixture(); cleanup = fixture.cleanup;
  const headers = new Headers({ cookie: `${teamSessionCookieName()}=${fixture.member.token.plaintext}`, 'x-ri-member-id': fixture.owner.member.id, 'x-ri-member-role': 'owner' });
  expect(pageViewerKey(headers)).toMatchObject({ scope: 'member', memberId: fixture.member.member.id, memberRole: 'member' });
  expect(pageViewerKey(new Headers({ cookie: `${SESSION_COOKIE_NAME}=${fixture.member.token.plaintext}` }))).toBeNull();
  q.removeMember(fixture.member.member.id); expect(pageViewerKey(headers)).toBeNull();
});
