import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as XLSX from 'xlsx';
import { APP_SHORT_ID } from '@/constants/app';
import type { Attachment } from '@/db/types';

// We test the public extractor, but it routes by mime + extension and
// reads from the configured attachments directory. Each test sets up
// an isolated APP_ROOT so files don't bleed between cases. Mammoth/
// officeparser branches are not exercised here — they delegate fully
// to those libraries; covering them would require committing binary
// fixtures, which adds maintenance for little safety. Their routing
// (mime → which library) is covered by integration smoke and the
// type signature.

function mkAtt(file_name: string, overrides: Partial<Attachment> = {}): Attachment {
  return {
    file_name,
    original_name: overrides.original_name ?? file_name,
    mime_type: overrides.mime_type ?? 'text/plain',
    size: overrides.size ?? 0,
    uploaded_at: overrides.uploaded_at ?? '2026-04-21T00:00:00.000Z',
  };
}

describe('extractTextFromAttachment', () => {
  let tmpDir: string;
  let attachmentsDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-extract-'));
    attachmentsDir = path.join(tmpDir, 'brain', 'attachments');
    fs.mkdirSync(attachmentsDir, { recursive: true });
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'brain', 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeFixture(name: string, contents: string | Buffer): void {
    const p = path.join(attachmentsDir, name);
    fs.writeFileSync(p, contents);
  }

  it('reads plain text', async () => {
    writeFixture('a.txt', 'hello world');
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('a.txt'));
    expect(result).toEqual({ text: 'hello world', via: 'utf8' });
  });

  it('reads code files (text/plain via TEXT_LIKE_EXTS)', async () => {
    const code = 'export const x: number = 42;\n';
    writeFixture('foo.ts', code);
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('foo.ts', { mime_type: 'text/plain' }));
    expect(result?.text).toBe(code);
    expect(result?.via).toBe('utf8');
  });

  it('reads JSON', async () => {
    const json = '{"key":"value"}';
    writeFixture('data.json', json);
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('data.json', { mime_type: 'application/json' }));
    expect(result?.text).toBe(json);
  });

  it('reads SVG as XML source (image/svg+xml)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
    writeFixture('icon.svg', svg);
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('icon.svg', { mime_type: 'image/svg+xml' }));
    expect(result?.text).toBe(svg);
    expect(result?.via).toBe('svg → source');
  });

  it('extracts xlsx as CSV per non-empty sheet', async () => {
    // Build a real xlsx via the same library the extractor uses.
    // SheetJS 0.20+ doesn't ship `fs` bound by default (ESM/edge safety);
    // wire it explicitly for write.
    XLSX.set_fs(fs);
    const wb = XLSX.utils.book_new();
    const sheet1 = XLSX.utils.aoa_to_sheet([
      ['name', 'qty'],
      ['widget', 5],
      ['gizmo', 10],
    ]);
    const empty = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, sheet1, 'Inventory');
    XLSX.utils.book_append_sheet(wb, empty, 'Empty');
    const xlsxPath = path.join(attachmentsDir, 'data.xlsx');
    XLSX.writeFile(wb, xlsxPath);

    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('data.xlsx', {
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    expect(result?.text).toContain('## Sheet: Inventory');
    expect(result?.text).toContain('name,qty');
    expect(result?.text).toContain('widget,5');
    expect(result?.text).not.toContain('## Sheet: Empty'); // empty sheets skipped
    expect(result?.via).toBe('xlsx → csv');
  });

  it('truncates extraction beyond 200k chars and marks via', async () => {
    const big = 'x'.repeat(250_000);
    writeFixture('big.txt', big);
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('big.txt'));
    expect(result?.text.length).toBeLessThan(big.length);
    expect(result?.text).toContain('[truncated');
    expect(result?.via).toContain('(truncated)');
  });

  it('returns null for audio when no STT provider is available', async () => {
    writeFixture('memo.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3])); // EBML magic
    // Mock the STT module to simulate "no provider configured/available".
    vi.doMock('@/lib/stt/transcribe', () => ({
      pickProvider: vi.fn().mockRejectedValue(new Error('No speech-to-text provider available')),
      transcribe: vi.fn(),
    }));
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('memo.webm', { mime_type: 'audio/webm' }));
    expect(result).toBeNull();
  });

  it('returns null when STT returns empty string', async () => {
    writeFixture('silent.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    vi.doMock('@/lib/stt/transcribe', () => ({
      pickProvider: vi.fn().mockResolvedValue('local/parakeet-tdt-0.6b-v3'),
      transcribe: vi.fn().mockResolvedValue('   '),
    }));
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('silent.webm', { mime_type: 'audio/webm' }));
    expect(result).toBeNull();
  });

  it('returns transcript text when STT succeeds', async () => {
    writeFixture('memo.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    vi.doMock('@/lib/stt/transcribe', () => ({
      pickProvider: vi.fn().mockResolvedValue('local/parakeet-tdt-0.6b-v3'),
      transcribe: vi.fn().mockResolvedValue('  hello, world  '),
    }));
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('memo.webm', { mime_type: 'audio/webm' }));
    expect(result?.text).toBe('hello, world');
    expect(result?.via).toBe('audio → local/parakeet-tdt-0.6b-v3');
  });

  it('returns null for unsupported mimes (e.g. video)', async () => {
    writeFixture('clip.mp4', Buffer.from([0, 0, 0, 0]));
    const { extractTextFromAttachment } = await import('./extract-text');
    const result = await extractTextFromAttachment(mkAtt('clip.mp4', { mime_type: 'video/mp4' }));
    expect(result).toBeNull();
  });
});

describe('formatExtractedAttachment', () => {
  it('wraps text with filename and escapes attribute injection', async () => {
    const { formatExtractedAttachment } = await import('./extract-text');
    const out = formatExtractedAttachment(
      mkAtt('foo.txt', { original_name: 'My "Notes" & <stuff>.txt' }),
      { text: 'body', via: 'utf8' },
    );
    // `>` isn't required to be escaped in XML attribute values; only
    // `&`, `"`, and `<` are. Matches the actual escapeAttr behavior.
    expect(out).toContain('filename="My &quot;Notes&quot; &amp; &lt;stuff>.txt"');
    expect(out).toContain('\nbody\n');
    expect(out.startsWith('<attachment')).toBe(true);
    expect(out.endsWith('</attachment>')).toBe(true);
  });

  it('adds audio-transcript hint for STT-derived text', async () => {
    const { formatExtractedAttachment } = await import('./extract-text');
    const out = formatExtractedAttachment(
      mkAtt('a.webm', { mime_type: 'audio/webm', original_name: 'memo.webm' }),
      { text: 'hello', via: 'audio → local/parakeet-tdt-0.6b-v3' },
    );
    expect(out).toContain('kind="audio-transcript"');
  });

  it('omits kind hint for non-audio extractions', async () => {
    const { formatExtractedAttachment } = await import('./extract-text');
    const out = formatExtractedAttachment(
      mkAtt('a.txt'),
      { text: 'hello', via: 'utf8' },
    );
    expect(out).not.toContain('kind=');
  });
});
