/**
 * Google Workspace toolkits (Drive / Docs / Sheets) — they share the one Google connection,
 * so they also exercise incremental consent (a Calendar-only connection asked to read Drive →
 * needs_consent for the Drive scope) and absolute-URL routing (Docs/Sheets hosts).
 */
import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import { GOOGLE_SCOPES } from '../providers/google';
import type { FakeHttpCall } from '../testing';

const CALENDAR_ONLY = ['openid', 'email', GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];

describe('google_drive', () => {
  it('lists files', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = (c: FakeHttpCall) => {
      expect(c.url).toContain('/drive/v3/files');
      return { json: { files: [{ id: 'f1', name: 'Report', mimeType: 'application/pdf', size: '123' }] } };
    };
    const out = await h.runtime.runAction('google_drive.list_files', { query: "name contains 'Report'" });
    expect(out.ok).toBe(true);
    expect((out as { result: { files: Array<{ id: string; size: number }> } }).result.files[0]).toMatchObject({ id: 'f1', size: 123 });
  });

  it('a Calendar-only connection asked to read Drive → needs_consent for the Drive scope', async () => {
    const h = makeHarness();
    await h.connect({ scopes: CALENDAR_ONLY });
    const out = await h.runtime.runAction('google_drive.list_files', {});
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent', providerId: 'google' });
    expect((out as { missingScopes: string[] }).missingScopes).toEqual([GOOGLE_SCOPES.driveReadonly]);
  });
});

describe('google_docs (absolute-URL host)', () => {
  it('gets a document and flattens its text', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = (c: FakeHttpCall) => {
      expect(c.url.startsWith('https://docs.googleapis.com/v1/documents/')).toBe(true);
      return {
        json: {
          documentId: 'd1',
          title: 'Notes',
          body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'world' } }] } }] },
        },
      };
    };
    const out = await h.runtime.runAction('google_docs.get_document', { documentId: 'd1' });
    expect(out.ok).toBe(true);
    expect((out as { result: { text: string } }).result).toMatchObject({ documentId: 'd1', title: 'Notes', text: 'Hello world' });
  });

  it('appends text (mutating, gated then allowed)', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let body: string | undefined;
    h.env.action = (c: FakeHttpCall) => {
      body = c.body;
      return { json: {} };
    };
    const out = await h.runtime.runAction('google_docs.append_text', { documentId: 'd1', text: 'more' });
    expect(out.ok).toBe(true);
    expect(body).toContain('insertText');
    expect(body).toContain('more');
  });
});

describe('google_sheets (absolute-URL host)', () => {
  it('reads a range', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = (c: FakeHttpCall) => {
      expect(c.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets/')).toBe(true);
      return { json: { range: 'Sheet1!A1:B2', values: [['a', 'b'], ['c', 'd']] } };
    };
    const out = await h.runtime.runAction('google_sheets.get_values', { spreadsheetId: 's1', range: 'Sheet1!A1:B2' });
    expect(out.ok).toBe(true);
    expect((out as { result: { values: unknown[][] } }).result.values).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('appends rows with USER_ENTERED', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    let url = '';
    h.env.action = (c: FakeHttpCall) => {
      url = c.url;
      return { json: { updates: { updatedRange: 'Sheet1!A3', updatedRows: 1 } } };
    };
    const out = await h.runtime.runAction('google_sheets.append_values', { spreadsheetId: 's1', range: 'Sheet1!A1', values: [['x', 1]] });
    expect(out.ok).toBe(true);
    expect(url).toContain(':append');
    expect(url).toContain('valueInputOption=USER_ENTERED');
  });
});
