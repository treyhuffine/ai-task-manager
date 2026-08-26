import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import { encodeEmail } from '../providers/google/gmail';
import { GOOGLE_SCOPES } from '../providers/google';

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('gmail encodeEmail — header-injection safe (P1-a)', () => {
  it('throws if a header value contains a line break (defense in depth)', () => {
    expect(() => encodeEmail({ to: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'b' })).toThrow(/line break/);
    expect(() => encodeEmail({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 's', body: 'b' })).toThrow(/line break/);
  });

  it('RFC 2047-encodes a non-ASCII subject and base64-encodes the body', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 'Café résumé', body: 'héllo' }));
    expect(msg).toContain('Subject: =?UTF-8?B?');
    expect(msg).toContain('Content-Transfer-Encoding: base64');
    expect(msg).not.toContain('Content-Transfer-Encoding: 7bit');
    expect(msg).toContain(Buffer.from('héllo', 'utf8').toString('base64'));
  });

  it('leaves a plain ASCII subject unencoded', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 'Hello there', body: 'b' }));
    expect(msg).toContain('Subject: Hello there');
  });
});

describe('gmail schemas reject injection at validation (P1-a)', () => {
  it('rejects a CRLF in the subject with invalid_input (before any side effect)', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'invalid_input' });
  });

  it('rejects a recipient that is not an email address', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    const out = await h.runtime.runAction('gmail.send_email', { to: 'not-an-email', subject: 's', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'invalid_input' });
  });

  it('accepts a comma-separated recipient list', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1' } });
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com, c@d.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true);
  });
});

describe('gmail scope hierarchy (P2-b / P2-c)', () => {
  it('connecting the full toolkit bundle can create a draft (bundle includes compose)', async () => {
    const h = makeHarness();
    const bundle = h.runtime.getToolkits().find((t) => t.id === 'gmail')?.scopes ?? [];
    expect(bundle).toContain(GOOGLE_SCOPES.gmailCompose); // the union now includes it
    await h.connect({ scopes: bundle });
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'draft1', message: { id: 'm1' } } });
    const out = await h.runtime.runAction('gmail.create_draft', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true); // NOT needs_consent
  });

  it('a connection holding gmail.modify satisfies create_draft (compose) via the hierarchy', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.gmailModify] });
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'draft1', message: { id: 'm1' } } });
    const out = await h.runtime.runAction('gmail.create_draft', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true);
  });

  it('a connection holding only calendar.events satisfies event reads (events ⊇ events.readonly)…', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarEvents] });
    h.env.action = () => ({ json: { items: [] } });
    const out = await h.runtime.runAction('google_calendar.list_events', { calendarId: 'primary' });
    expect(out.ok).toBe(true);
  });

  it('…but calendar.events does NOT satisfy list_calendars (needs calendar.readonly) — stays conservative', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarEvents] });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent' });
    expect((out as { missingScopes: string[] }).missingScopes).toEqual([GOOGLE_SCOPES.calendarReadonly]);
  });
});

describe('gmail.get_message honors format (P3)', () => {
  it('surfaces parsed headers and decoded body when the payload is present', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({
      json: {
        id: 'm1',
        threadId: 't1',
        snippet: 'hi',
        labelIds: ['INBOX'],
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'Subject', value: 'Hello' },
            { name: 'Message-ID', value: '<orig@mail.gmail.com>' },
            { name: 'References', value: '<first@mail.gmail.com> <second@mail.gmail.com>' },
            { name: 'X-Other', value: 'ignored' },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('body text', 'utf8').toString('base64url') } }],
        },
      },
    });
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1', format: 'full' });
    expect(out.ok).toBe(true);
    const r = (out as { result: { headers?: Record<string, string>; text?: string } }).result;
    expect(r.headers).toMatchObject({ From: 'alice@example.com', Subject: 'Hello' });
    // The reply-threading inputs an agent reads back: Message-ID → inReplyTo, References → references.
    expect(r.headers).toMatchObject({
      'Message-ID': '<orig@mail.gmail.com>',
      References: '<first@mail.gmail.com> <second@mail.gmail.com>',
    });
    expect(r.headers).not.toHaveProperty('X-Other'); // only the curated set
    expect(r.text).toBe('body text');
  });

  it('returns no headers/text when the response has no payload (minimal)', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1', snippet: 'hi', labelIds: [] } });
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1', format: 'minimal' });
    expect(out.ok).toBe(true);
    const r = (out as { result: Record<string, unknown> }).result;
    expect(r).not.toHaveProperty('headers');
    expect(r).not.toHaveProperty('text');
  });
});

describe('gmail reply threading (create_draft / send_email)', () => {
  it('encodeEmail sets In-Reply-To and References from inReplyTo', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 'Re: Hi', body: 'b', inReplyTo: '<orig@mail.gmail.com>' }));
    expect(msg).toContain('In-Reply-To: <orig@mail.gmail.com>');
    expect(msg).toContain('References: <orig@mail.gmail.com>');
  });

  it('encodeEmail omits reply headers when inReplyTo is absent', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 's', body: 'b' }));
    expect(msg).not.toContain('In-Reply-To');
    expect(msg).not.toContain('References');
  });

  it('encodeEmail rejects a line break in inReplyTo (header-injection guard)', () => {
    expect(() => encodeEmail({ to: 'a@b.com', subject: 's', body: 'b', inReplyTo: '<x>\r\nBcc: evil@x.com' })).toThrow(
      /line break/,
    );
  });

  it('encodeEmail builds the full References chain (parent references + inReplyTo), In-Reply-To stays the parent only', () => {
    const msg = decode(
      encodeEmail({
        to: 'a@b.com',
        subject: 'Re: Hi',
        body: 'b',
        inReplyTo: '<third@mail.gmail.com>',
        references: '<first@mail.gmail.com> <second@mail.gmail.com>',
      }),
    );
    expect(msg).toContain('References: <first@mail.gmail.com> <second@mail.gmail.com> <third@mail.gmail.com>');
    // In-Reply-To names only the immediate parent, never the whole chain.
    expect(msg).toContain('In-Reply-To: <third@mail.gmail.com>');
    expect(msg).not.toContain('In-Reply-To: <first@mail.gmail.com>');
  });

  it('encodeEmail rejects a line break in references (header-injection guard)', () => {
    expect(() =>
      encodeEmail({ to: 'a@b.com', subject: 's', body: 'b', references: '<a>\r\nBcc: evil@x.com' }),
    ).toThrow(/line break/);
  });

  it('create_draft threads the draft: sets message.threadId + reply headers on the request', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let sentBody = '';
    h.env.action = (call) => {
      sentBody = call.body ?? '';
      return { json: { id: 'draft1', message: { id: 'm1', threadId: 't-123' } } };
    };
    const out = await h.runtime.runAction('gmail.create_draft', {
      to: 'a@b.com',
      subject: 'Re: Hi',
      body: 'b',
      threadId: 't-123',
      inReplyTo: '<orig@mail.gmail.com>',
    });
    expect(out.ok).toBe(true);
    expect((out as { result: { threadId?: string } }).result.threadId).toBe('t-123');
    const body = JSON.parse(sentBody) as { message: { raw: string; threadId?: string } };
    expect(body.message.threadId).toBe('t-123');
    const raw = Buffer.from(body.message.raw, 'base64url').toString('utf8');
    expect(raw).toContain('In-Reply-To: <orig@mail.gmail.com>');
    expect(raw).toContain('References: <orig@mail.gmail.com>');
  });

  it('create_draft without threadId stays a plain, unthreaded draft', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let sentBody = '';
    h.env.action = (call) => {
      sentBody = call.body ?? '';
      return { json: { id: 'draft1', message: { id: 'm1' } } };
    };
    const out = await h.runtime.runAction('gmail.create_draft', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true);
    const body = JSON.parse(sentBody) as { message: { raw: string; threadId?: string } };
    expect(body.message.threadId).toBeUndefined();
    const raw = Buffer.from(body.message.raw, 'base64url').toString('utf8');
    expect(raw).not.toContain('In-Reply-To');
  });

  it('send_email threads a reply: sets top-level threadId + reply headers', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let sentBody = '';
    h.env.action = (call) => {
      sentBody = call.body ?? '';
      return { json: { id: 'm1', threadId: 't-9' } };
    };
    const out = await h.runtime.runAction('gmail.send_email', {
      to: 'a@b.com',
      subject: 'Re: Hi',
      body: 'b',
      threadId: 't-9',
      inReplyTo: '<orig@mail.gmail.com>',
    });
    expect(out.ok).toBe(true);
    const body = JSON.parse(sentBody) as { raw: string; threadId?: string };
    expect(body.threadId).toBe('t-9');
    const raw = Buffer.from(body.raw, 'base64url').toString('utf8');
    expect(raw).toContain('In-Reply-To: <orig@mail.gmail.com>');
  });

  it('create_draft with references carries the full ancestry chain into the raw message', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let sentBody = '';
    h.env.action = (call) => {
      sentBody = call.body ?? '';
      return { json: { id: 'draft1', message: { id: 'm1', threadId: 't-123' } } };
    };
    const out = await h.runtime.runAction('gmail.create_draft', {
      to: 'a@b.com',
      subject: 'Re: Hi',
      body: 'b',
      threadId: 't-123',
      inReplyTo: '<third@mail.gmail.com>',
      references: '<first@mail.gmail.com> <second@mail.gmail.com>',
    });
    expect(out.ok).toBe(true);
    const body = JSON.parse(sentBody) as { message: { raw: string } };
    const raw = Buffer.from(body.message.raw, 'base64url').toString('utf8');
    expect(raw).toContain('References: <first@mail.gmail.com> <second@mail.gmail.com> <third@mail.gmail.com>');
    expect(raw).toContain('In-Reply-To: <third@mail.gmail.com>');
  });
});
