/**
 * §14 acceptance, exercised end-to-end against the fake Google backend. The
 * remaining acceptance items (real token exchange against Google, a real send)
 * are inherently manual / integration and are noted in the implementation report.
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import { GOOGLE_SCOPES } from '../providers/google';
import type { FakeHttpCall } from '../testing';

const CALENDAR_ONLY = ['openid', 'email', GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];

describe('§14 acceptance', () => {
  it('#1 two Google accounts connect; both accountId/email captured', async () => {
    const h = makeHarness();
    const a = await h.connect({ email: 'personal@gmail.com' });
    const b = await h.connect({ email: 'work@gmail.com' });
    expect(a.accountId).not.toBe(b.accountId);
    const list = await h.runtime.listConnections({ providerId: 'google' });
    expect(list.map((c) => c.email).sort()).toEqual(['personal@gmail.com', 'work@gmail.com']);
  });

  it('end-to-end: connect (calendar) → create event → gmail send blocked → consent upgrade → approve → send → disconnect', async () => {
    const h = makeHarness();
    h.setApproval(() => 'allow');
    h.env.action = (call: FakeHttpCall) => {
      if (call.url.includes('/events') && call.method === 'POST') return { json: { id: 'evt1', htmlLink: 'https://cal/evt1' } };
      if (call.url.includes('/messages/send')) return { json: { id: 'msg1', threadId: 'thr1' } };
      return { json: {} };
    };

    // 1. Connect with Calendar scope only.
    const conn = await h.connect({ email: 'me@gmail.com', scopes: CALENDAR_ONLY });

    // 2. Create an event — works (has calendar.events), passes the approval gate.
    const created = await h.runtime.runAction('google_calendar.create_event', {
      summary: 'Weekly sync',
      start: '2026-06-20T15:00:00Z',
      end: '2026-06-20T15:30:00Z',
    });
    expect(created).toMatchObject({ ok: true, result: { id: 'evt1' } });

    // 3. Ask to send mail → needs_consent (gmail.send not granted yet).
    const blocked = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 'hi', body: 'yo' });
    expect(blocked).toMatchObject({ ok: false, reason: 'needs_consent', connectionId: conn.id });

    // 4. Upgrade consent on the SAME connection (same Google account).
    const upgraded = await h.connect({
      email: 'me@gmail.com',
      existingConnectionId: conn.id,
      scopes: [...CALENDAR_ONLY, GOOGLE_SCOPES.gmailSend],
    });
    expect(upgraded.id).toBe(conn.id);

    // 5. Send now succeeds.
    const sent = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 'hi', body: 'yo' });
    expect(sent).toMatchObject({ ok: true, result: { id: 'msg1' } });

    // 6. Disconnect revokes at Google, then removes local state.
    await h.runtime.disconnectConnection(conn.id);
    expect(h.env.revokeCount).toBe(1);
    expect(await h.store.get(conn.id)).toBeNull();
  });

  it('#8 a connected-account send never leaks the token into audit', async () => {
    const h = makeHarness();
    h.env.exchangeToken = { access_token: 'tok-SENTINEL-9', refresh_token: 'rt-SENTINEL-9', expires_in: 3600, scope: '' };
    h.setApproval(() => 'allow');
    await h.connect();
    h.env.action = () => ({ json: { id: 'msg1', threadId: 'thr1' } });
    h.runs.length = 0;
    await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(JSON.stringify(h.runs)).not.toContain('SENTINEL');
  });
});
